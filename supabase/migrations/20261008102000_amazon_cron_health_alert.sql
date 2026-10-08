-- Amazon cron failure alerting (2026-10-08): amazon-nightly-refresh failed
-- silently for 8 nights before being noticed. A daily 07:30 check emails
-- Robert (via edge fn amazon-cron-health-alert) when any amazon-* job has
-- failed two nights running. Bounded to trailing 30 days: cron.job_run_details
-- holds 330k+ rows and an unbounded scan breached the API 8s timeout.
-- Applied to prod 2026-10-08 via MCP. SERVICE_ROLE_KEY_PLACEHOLDER must be
-- replaced when applying by hand (same pattern as the other amazon crons).
create or replace function public.amazon_cron_health_failing()
returns table (
  jobname text,
  schedule text,
  last_success timestamptz,
  fail_days bigint,
  latest_error text
)
language sql
stable
security definer
set search_path = public
as $$
  with amazon_jobs as (
    select j.jobid, j.jobname, j.schedule
    from cron.job j
    where j.jobname like 'amazon-%' and j.active
  ),
  runs as (
    select d.jobid, d.status, d.return_message, d.start_time, d.end_time
    from cron.job_run_details d
    join amazon_jobs aj on aj.jobid = d.jobid
    where d.start_time > now() - interval '30 days'
  ),
  agg as (
    select
      r.jobid,
      max(r.end_time) filter (where r.status = 'succeeded') as last_success,
      (array_agg(r.status order by r.start_time desc))[1] as latest_status,
      (array_agg(left(r.return_message, 300) order by r.start_time desc))[1] as latest_msg
    from runs r
    group by r.jobid
  ),
  fail_days as (
    select r.jobid, count(distinct r.start_time::date) as fail_days
    from runs r
    join agg a on a.jobid = r.jobid
    where r.status = 'failed'
      and r.start_time > coalesce(a.last_success, '-infinity'::timestamptz)
    group by r.jobid
  )
  select aj.jobname, aj.schedule, a.last_success, fd.fail_days, a.latest_msg
  from amazon_jobs aj
  join agg a on a.jobid = aj.jobid and a.latest_status = 'failed'
  join fail_days fd on fd.jobid = aj.jobid and fd.fail_days >= 2
  where a.last_success is null or a.last_success < now() - interval '36 hours'
  order by aj.jobname
$$;
revoke all on function public.amazon_cron_health_failing() from public, anon, authenticated;
grant execute on function public.amazon_cron_health_failing() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'amazon-cron-health-check';
select cron.schedule(
  'amazon-cron-health-check',
  '30 7 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-cron-health-alert',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer SERVICE_ROLE_KEY_PLACEHOLDER'),
    body := jsonb_build_object('triggered_by','cron'),
    timeout_milliseconds := 60000);
  $job$
);
