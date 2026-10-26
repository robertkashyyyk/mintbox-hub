-- 26 Oct 2026 — stop the eBay coverage job (job 66) false-alarming every morning.
--
-- Root cause: the weekly kickoff (coverage-ebay-kickoff, Mon 01:00) calls sync-ebay-coverage,
-- which returns HTTP 200 with body {"ok":false,"error":"...-> 429"} when 3D Sellers throttles a
-- listings page. cron_http_collect marks that body_not_ok; no pattern matched a 429-in-body, so the
-- catch-all tagged it unknown/flag. The continue job (67, every 10 min 1-4am) finishes the pass
-- anyway (listing_coverage_sync -> phase='done'), but BOTH monitors (hub-job-doctor 07:20,
-- job-health-alert 07:50) judged the job on the KICKOFF call and nagged until the next Monday.
--
-- Fixes:
--   1. (edge fn sync-ebay-coverage v22) retry the listings fetch on 429/5xx before giving up.
--   2. job_failure_patterns: classify a 429 (in body text, and a true HTTP 429) as transient.
--   3. judge the coverage pipeline on the sync reaching 'done' for THIS week's run (below).
--
-- Applied live via MCP apply_migration; mirrored here for version control.

CREATE OR REPLACE FUNCTION public.coverage_sync_healthy()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- healthy = the latest run COMPLETED at/after this ISO-week's Monday 01:00 kickoff.
  -- A failed/incomplete run (phase<>'done', or a done stamp from a prior week) stays unhealthy,
  -- so a genuinely broken weekly run still flags the same morning — no masking.
  SELECT EXISTS (
    SELECT 1 FROM public.listing_coverage_sync
    WHERE channel = 'ebay'
      AND phase = 'done'
      AND last_run_at >= ((date_trunc('week', (now() AT TIME ZONE 'Europe/London'))
                           + interval '1 hour') AT TIME ZONE 'Europe/London')
  );
$function$;

-- Only the SECURITY DEFINER monitors (get_job_health / job_doctor_collect) call this, as owner —
-- no API role needs it. Revoke the PostgREST surface (anon/authenticated) to avoid a SECURITY
-- DEFINER function being callable via /rest/v1/rpc; keep service_role only.
REVOKE EXECUTE ON FUNCTION public.coverage_sync_healthy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coverage_sync_healthy() TO service_role;

-- 429 = transient (two match modes: in-body text, and a true HTTP 429 status).
-- text_ilike is the edge fn's exact "...-> 429" throttle string (NOT a bare '%429%', which would
-- match any error text containing 429 on any job). auto_action = flag, never retry: job 67 already
-- resumes the coverage pass, so the doctor must not auto-retry a coverage kickoff.
INSERT INTO public.job_failure_patterns (text_ilike, status_lo, status_hi, class, auto_action, priority, enabled, note)
VALUES
 ('%-> 429%', NULL, NULL, 'transient', 'flag', 11, true, '429 rate-limit in the response body (3D Sellers listings "...-> 429" throttle) — transient; flag only, job 67 resumes the pass'),
 (NULL, 429, 429, 'transient', 'flag', 45, true, 'HTTP 429 Too Many Requests — transient rate-limit; flag only (precedes the generic 4xx=config rule)')
ON CONFLICT DO NOTHING;

-- job_doctor_collect: drop coverage-ebay-* failures when the sync completed this week.
-- (Full body re-created; only the final WHERE gains the coverage_sync_healthy() guard.)
CREATE OR REPLACE FUNCTION public.job_doctor_collect()
 RETURNS TABLE(jobname text, kind text, status_code integer, last_error text, class text, auto_action text, retry_safe boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron'
 SET statement_timeout TO '60s'
AS $function$
  WITH hc AS (
    SELECT DISTINCT ON (c.jobname) c.jobname, c.outcome AS status,
           coalesce(c.error_msg, c.body_snippet) AS err, c.status_code, 'http' AS kind
    FROM public.cron_http_calls c
    WHERE c.called_at > now() - interval '24 hours' AND c.outcome <> 'pending'
    ORDER BY c.jobname, c.called_at DESC
  ),
  rd AS (
    SELECT DISTINCT ON (j.jobname) j.jobname, d.status, d.return_message AS err,
           NULL::int AS status_code, 'sql' AS kind
    FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
    WHERE d.start_time > now() - interval '24 hours'
    ORDER BY j.jobname, d.start_time DESC
  ),
  failing AS (
    SELECT jobname, kind, status_code, err AS last_error FROM hc WHERE status <> 'ok'
    UNION ALL
    SELECT jobname, kind, status_code, err FROM rd
    WHERE status = 'failed' AND jobname NOT IN (SELECT jobname FROM hc)
  ),
  classified AS (
    SELECT f.jobname, f.kind, f.status_code, f.last_error, p.class, p.auto_action,
           row_number() OVER (PARTITION BY f.jobname ORDER BY p.priority) AS rn
    FROM failing f
    JOIN public.job_failure_patterns p ON p.enabled
      AND ( (p.text_ilike IS NOT NULL AND coalesce(f.last_error,'') ILIKE p.text_ilike)
         OR (p.status_lo IS NOT NULL AND f.status_code BETWEEN p.status_lo AND p.status_hi) )
  )
  SELECT c.jobname, c.kind, c.status_code, left(c.last_error, 300), c.class, c.auto_action,
         coalesce(o.retry_safe, false)
  FROM classified c
  JOIN cron.job j ON j.jobname = c.jobname AND j.active
  LEFT JOIN public.job_health_overrides o ON o.jobname = c.jobname
  WHERE c.rn = 1 AND coalesce(o.ignore, false) = false
    AND NOT (c.jobname LIKE 'coverage-ebay-%' AND public.coverage_sync_healthy());
$function$;

-- get_job_health: force 'ok' for coverage jobs when the sync completed this week.
-- (Full body re-created; only the final status CASE gains the coverage branch.)
CREATE OR REPLACE FUNCTION public.get_job_health()
 RETURNS TABLE(jobid bigint, jobname text, schedule text, kind text, tracked boolean, max_gap interval, last_ok timestamp with time zone, last_attempt timestamp with time zone, last_outcome text, last_detail text, ok_24h bigint, bad_24h bigint, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron'
 SET statement_timeout TO '60s'
AS $function$
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
           case when x.jobname like 'coverage-ebay-%' and public.coverage_sync_healthy() then 'ok'
                when x.no_runs then 'new'
                when x.last_ok_at is null or x.last_ok_at < now() - x.max_gap then 'stale'
                when x.bad24 > 0 and x.bad24 >= x.ok24 then 'degraded'
                else 'ok' end as status
    from x
  )
  select * from y
  order by case y.status when 'stale' then 0 when 'degraded' then 1 when 'new' then 2 else 3 end, y.jobname;
$function$;
