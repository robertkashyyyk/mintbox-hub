-- RPC to fetch recent runs for a given cron job, for use in System Health drilldown
CREATE OR REPLACE FUNCTION public.get_system_health_job_runs(_jobname text, _limit int DEFAULT 25)
RETURNS TABLE(
  runid bigint,
  job_pid integer,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz,
  duration_ms integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT
    jrd.runid,
    jrd.job_pid,
    jrd.database,
    jrd.username,
    jrd.command,
    jrd.status,
    jrd.return_message,
    jrd.start_time,
    jrd.end_time,
    CASE
      WHEN jrd.end_time IS NOT NULL AND jrd.start_time IS NOT NULL
      THEN (EXTRACT(EPOCH FROM (jrd.end_time - jrd.start_time)) * 1000)::int
      ELSE NULL
    END AS duration_ms
  FROM cron.job j
  JOIN cron.job_run_details jrd ON jrd.jobid = j.jobid
  WHERE j.jobname = _jobname
  ORDER BY jrd.start_time DESC NULLS LAST
  LIMIT GREATEST(_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_system_health_job_runs(text, int) TO authenticated;