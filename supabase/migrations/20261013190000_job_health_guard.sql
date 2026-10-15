-- 2026-10-13: silent-failure guard for pg_cron jobs.
--
-- Problem: an HTTP cron job "succeeds" in cron.job_run_details as soon as pg_net has
-- queued the request. The edge function can then 500, time out, or return 200 with
-- {"ok":false}, and nothing notices (the cost-floor guard was dead from July to October
-- that way). pg_net keeps responses for only 6 hours.
--
-- 1. public.cron_http_post(job, url := ..., headers := ..., body := ...) — drop-in for
--    net.http_post in cron commands. Same arguments; also records (job, request id) and
--    floors the timeout at 400 s so pg_net waits for the real response.
-- 2. public.cron_http_collect() — every 5 min, copies each response's real outcome
--    (status, timeout, ok:false in the body) into public.cron_http_calls.
-- 3. public.get_job_health() — per active job: last real success vs its expected window
--    (public.cron_expected_gap(schedule), overridable in public.job_health_overrides).
-- 4. Edge function job-health-alert (daily) emails Robert via Resend when a job is stale
--    or failing most of its runs; every check is logged in public.job_health_runs.

create or replace function public.try_jsonb(p text) returns jsonb
language plpgsql immutable as $$
begin
  return p::jsonb;
exception when others then
  return null;
end $$;

create table if not exists public.cron_http_calls (
  id            bigserial primary key,
  jobname       text not null,
  request_id    bigint not null,
  url           text,
  called_at     timestamptz not null default now(),
  outcome       text not null default 'pending'
                check (outcome in ('pending','ok','http_error','body_not_ok','timeout','error','lost')),
  status_code   integer,
  timed_out     boolean,
  error_msg     text,
  body_ok       boolean,
  body_snippet  text,
  resolved_at   timestamptz
);
create index if not exists cron_http_calls_pending_idx on public.cron_http_calls (request_id) where outcome = 'pending';
create index if not exists cron_http_calls_job_idx on public.cron_http_calls (jobname, called_at desc);
alter table public.cron_http_calls enable row level security;
revoke all on table public.cron_http_calls from public, anon, authenticated;
grant select on table public.cron_http_calls to service_role;
comment on table public.cron_http_calls is
  'One row per HTTP request made by a pg_cron job via public.cron_http_post; outcome filled in by public.cron_http_collect() from net._http_response.';

-- Same parameter names, order and defaults as net.http_post, with the job name first,
-- so a cron command converts by swapping "net.http_post(" for
-- "public.cron_http_post('<jobname>', ".
create or replace function public.cron_http_post(
  p_job text,
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint
language plpgsql
set search_path = public, net
as $$
declare
  v_id bigint;
begin
  v_id := net.http_post(
    url := url, body := body, params := params, headers := headers,
    -- wait for the real response (edge functions run up to 400 s); the caller's shorter
    -- timeout only ever hid the outcome
    timeout_milliseconds := greatest(coalesce(timeout_milliseconds, 0), 400000)
  );
  insert into public.cron_http_calls (jobname, request_id, url) values (p_job, v_id, url);
  return v_id;
end $$;
revoke all on function public.cron_http_post(text, text, jsonb, jsonb, jsonb, integer) from public, anon, authenticated;

create or replace function public.cron_http_collect() returns integer
language plpgsql
set search_path = public, net
as $$
declare
  v_n integer;
begin
  with r as (
    select c.id, h.status_code, h.timed_out, h.error_msg, h.content,
           public.try_jsonb(h.content) as j
    from public.cron_http_calls c
    join net._http_response h on h.id = c.request_id
    where c.outcome = 'pending'
  ), o as (
    select r.*,
           case
             when r.j is null or jsonb_typeof(r.j) <> 'object' then null
             when r.j ? 'ok' and jsonb_typeof(r.j->'ok') = 'boolean' then (r.j->>'ok')::boolean
             when r.j ? 'success' and jsonb_typeof(r.j->'success') = 'boolean' then (r.j->>'success')::boolean
             when r.j ? 'error' and r.j->'error' <> 'null'::jsonb then false
           end as body_ok
    from r
  )
  update public.cron_http_calls c set
    status_code  = o.status_code,
    timed_out    = o.timed_out,
    error_msg    = left(o.error_msg, 500),
    body_ok      = o.body_ok,
    body_snippet = left(o.content, 500),
    resolved_at  = now(),
    outcome = case
      when coalesce(o.timed_out, false) then 'timeout'
      when o.status_code is null then 'error'
      when o.status_code not between 200 and 299 then 'http_error'
      when o.body_ok is false then 'body_not_ok'
      else 'ok'
    end
  from o where o.id = c.id;
  get diagnostics v_n = row_count;

  -- pg_net drops responses after 6 h; anything still pending by then is lost
  update public.cron_http_calls set outcome = 'lost', resolved_at = now()
  where outcome = 'pending' and called_at < now() - interval '5 hours 45 minutes';
  -- no retention prune yet (~2.5k rows/day); add one with Robert's OK
  return v_n;
end $$;
revoke all on function public.cron_http_collect() from public, anon, authenticated;

-- Longest normal gap between successful runs, from the cron schedule. Deliberately
-- generous; anything odd goes in public.job_health_overrides.
create or replace function public.cron_expected_gap(p_schedule text) returns interval
language plpgsql immutable as $$
declare
  f text[];
begin
  f := regexp_split_to_array(trim(p_schedule), '\s+');
  if coalesce(array_length(f, 1), 0) <> 5 then return interval '26 hours'; end if;
  if f[3] <> '*' or f[4] <> '*' then return interval '32 days'; end if;          -- monthly
  if f[5] <> '*' then
    if f[5] ~ '^\d$' then return interval '7 days 2 hours'; end if;              -- one day a week
    return interval '74 hours';                                                   -- weekdays: weekend gap
  end if;
  if f[2] = '*' then return interval '2 hours'; end if;                          -- every hour or more often
  if f[2] ~ '^\*/\d+$' then return make_interval(hours => substring(f[2] from 3)::int + 2); end if;
  return interval '26 hours';                                                     -- daily / certain hours daily
end $$;

create table if not exists public.job_health_overrides (
  jobname  text primary key,
  max_gap  interval,
  ignore   boolean not null default false,
  note     text not null
);
alter table public.job_health_overrides enable row level security;
revoke all on table public.job_health_overrides from public, anon, authenticated;
grant select on table public.job_health_overrides to service_role;
insert into public.job_health_overrides (jobname, ignore, note) values
  ('backfill-historical-orders-hourly', true, 'Auto-pauses: makes no request once ingest_run_state.historical_orders_cursor is DONE (DONE as of 2026-10-13).')
on conflict (jobname) do nothing;

create table if not exists public.job_health_runs (
  id          bigserial primary key,
  checked_at  timestamptz not null default now(),
  jobs        integer not null,
  stale       integer not null,
  degraded    integer not null,
  emailed     boolean not null default false,
  resend_id   text,
  error       text,
  detail      jsonb
);
alter table public.job_health_runs enable row level security;
revoke all on table public.job_health_runs from public, anon, authenticated;
grant select, insert on table public.job_health_runs to service_role;
grant usage on sequence public.job_health_runs_id_seq to service_role;

-- status: ok | stale (no real success within max_gap) | degraded (more failures than
-- successes in the last 24 h) | new (no runs on record yet).
-- HTTP jobs converted to cron_http_post are judged on the real response; until a job
-- has been tracked for a full window, cron's own "succeeded" (= queued) is accepted too.
create or replace function public.get_job_health()
returns table (
  jobid bigint, jobname text, schedule text, kind text, tracked boolean, max_gap interval,
  last_ok timestamptz, last_attempt timestamptz, last_outcome text, last_detail text,
  ok_24h bigint, bad_24h bigint, status text
)
language sql stable security definer
set search_path = public, cron
set statement_timeout = '60s'
as $$
  with j as (
    select j.jobid, j.jobname, j.schedule,
           (j.command ilike '%net.http_post%' or j.command ilike '%cron_http_post%') as is_http,
           (j.command ilike '%cron_http_post%') as tracked,
           coalesce(o.max_gap, public.cron_expected_gap(j.schedule)) as max_gap
    from cron.job j
    left join public.job_health_overrides o on o.jobname = j.jobname
    where j.active and not coalesce(o.ignore, false)
  ),
  rd as (
    select d.jobid,
           max(d.start_time) filter (where d.status = 'succeeded') as last_ok,
           max(d.start_time) as last_attempt,
           count(*) filter (where d.status = 'succeeded' and d.start_time > now() - interval '24 hours') as ok_24h,
           count(*) filter (where d.status = 'failed' and d.start_time > now() - interval '24 hours') as bad_24h
    from cron.job_run_details d
    where d.start_time > now() - interval '40 days'
    group by d.jobid
  ),
  rd_last as (
    select distinct on (d.jobid) d.jobid, d.status, d.return_message
    from cron.job_run_details d
    where d.start_time > now() - interval '40 days'
    order by d.jobid, d.start_time desc
  ),
  hc as (
    select c.jobname,
           max(c.called_at) filter (where c.outcome = 'ok') as last_ok,
           max(c.called_at) as last_attempt,
           min(c.called_at) as first_call,
           count(*) filter (where c.outcome = 'ok' and c.called_at > now() - interval '24 hours') as ok_24h,
           count(*) filter (where c.outcome not in ('ok','pending') and c.called_at > now() - interval '24 hours') as bad_24h
    from public.cron_http_calls c
    where c.called_at > now() - interval '40 days'
    group by c.jobname
  ),
  hc_last as (
    select distinct on (c.jobname) c.jobname, c.outcome,
           coalesce(c.error_msg, case when c.outcome <> 'ok' then c.body_snippet end) as detail
    from public.cron_http_calls c
    where c.outcome <> 'pending'
    order by c.jobname, c.called_at desc
  ),
  x as (
    select j.*,
           case when j.tracked and hc.first_call < now() - j.max_gap then hc.last_ok
                when j.tracked then greatest(hc.last_ok, rd.last_ok)
                else rd.last_ok end as last_ok_at,
           greatest(rd.last_attempt, hc.last_attempt) as last_attempt_at,
           case when rd_last.status = 'failed' then 'cron_failed'
                when j.tracked and hc_last.outcome is not null then hc_last.outcome
                else rd_last.status end as last_outcome,
           case when rd_last.status = 'failed' then left(rd_last.return_message, 300)
                when j.tracked then left(hc_last.detail, 300) end as last_detail,
           coalesce(case when j.tracked and hc.first_call < now() - interval '24 hours' then hc.ok_24h end, rd.ok_24h, 0) as ok24,
           coalesce(rd.bad_24h, 0) + coalesce(case when j.tracked then hc.bad_24h end, 0) as bad24,
           (rd.jobid is null and hc.jobname is null) as no_runs
    from j
    left join rd on rd.jobid = j.jobid
    left join rd_last on rd_last.jobid = j.jobid
    left join hc on hc.jobname = j.jobname
    left join hc_last on hc_last.jobname = j.jobname
  )
  , y as (
    select x.jobid, x.jobname, x.schedule, case when x.is_http then 'http' else 'sql' end as kind, x.tracked, x.max_gap,
           x.last_ok_at, x.last_attempt_at, x.last_outcome, x.last_detail, x.ok24, x.bad24,
           case when x.no_runs then 'new'
                when x.last_ok_at is null or x.last_ok_at < now() - x.max_gap then 'stale'
                when x.bad24 > 0 and x.bad24 >= x.ok24 then 'degraded'
                else 'ok' end as status
    from x
  )
  select * from y
  order by case y.status when 'stale' then 0 when 'degraded' then 1 when 'new' then 2 else 3 end, y.jobname;
$$;
revoke all on function public.get_job_health() from public, anon, authenticated;
grant execute on function public.get_job_health() to service_role;
