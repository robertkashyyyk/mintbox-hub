CREATE OR REPLACE FUNCTION public.get_system_health_jobs()
RETURNS TABLE(
  jobname text,
  schedule text,
  active boolean,
  last_start timestamptz,
  last_end timestamptz,
  last_status text,
  last_duration_ms integer,
  seconds_since_last_run integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (jobid) jobid, start_time, end_time, status
    FROM cron.job_run_details
    ORDER BY jobid, start_time DESC
  )
  SELECT
    j.jobname::text,
    j.schedule::text,
    j.active,
    l.start_time AS last_start,
    l.end_time AS last_end,
    l.status::text AS last_status,
    EXTRACT(EPOCH FROM (l.end_time - l.start_time))::integer * 1000 AS last_duration_ms,
    EXTRACT(EPOCH FROM (now() - l.start_time))::integer AS seconds_since_last_run
  FROM cron.job j
  LEFT JOIN latest l ON l.jobid = j.jobid
  WHERE j.active = true
  ORDER BY j.jobname;
$$;

REVOKE ALL ON FUNCTION public.get_system_health_jobs() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_system_health_jobs() TO authenticated;