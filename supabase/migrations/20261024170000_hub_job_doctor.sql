-- 20261024170000_hub_job_doctor.sql
--
-- Self-healing "job doctor": one daily digest of what broke, what the Hub re-fired
-- itself, and what needs a human — plus the kkh-trueup standing job. Built live via MCP
-- on 24 Oct; this migration is the repo copy so a fresh/repro deploy recreates it.
--
-- No JWT is committed: the two cron commands source the project anon bearer at run time
-- from an existing cron job's command (the same token the other HTTP crons use).
--
-- Edge functions live in supabase/functions/{hub-job-doctor,kkh-trueup} with
-- verify_jwt=true in config.toml (both are cron-invoked with a Bearer).

-- 1. Failure-pattern table + seed -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_failure_patterns (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  priority    int NOT NULL,
  text_ilike  text,
  status_lo   int,
  status_hi   int,
  class       text NOT NULL CHECK (class IN ('transient','structural','config','auth','unknown')),
  auto_action text NOT NULL CHECK (auto_action IN ('retry','flag')),
  note        text,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.job_failure_patterns (priority, text_ilike, status_lo, status_hi, class, auto_action, note)
SELECT * FROM (VALUES
 (10, '%startup%timeout%'::text, NULL::int, NULL::int, 'transient', 'retry', 'pg_cron job startup timeout (slot exhaustion/restart)'),
 (12, '%statement timeout%', NULL, NULL, 'structural', 'flag', 'query too slow — optimise/raise timeout, not a retry'),
 (13, '%bad request%', NULL, NULL, 'config', 'flag', 'upstream 4xx wrapped in a 500 by the edge fn'),
 (14, '%not enough stock%', NULL, NULL, 'config', 'flag', 'supplier stock mismatch / snapshot drift'),
 (16, '%unauthorized%', NULL, NULL, 'auth', 'flag', 'missing/invalid auth header'),
 (17, '%no authorization header%', NULL, NULL, 'auth', 'flag', 'missing auth header'),
 (20, '%idle timeout%', NULL, NULL, 'transient', 'retry', 'edge 150s idle timeout'),
 (21, '%IDLE_TIMEOUT%', NULL, NULL, 'transient', 'retry', 'edge 150s idle timeout code'),
 (30, NULL, 520, 520, 'transient', 'retry', 'Cloudflare 520'),
 (31, NULL, 522, 522, 'transient', 'retry', 'Cloudflare 522 origin unreachable'),
 (32, NULL, 504, 504, 'transient', 'retry', 'gateway timeout'),
 (33, NULL, 500, 503, 'transient', 'retry', 'generic 5xx — transient unless text says statement timeout'),
 (48, NULL, 401, 401, 'auth', 'flag', 'HTTP 401 unauthorized'),
 (50, NULL, 400, 499, 'config', 'flag', 'supplier/endpoint 4xx'),
 (999, '%', NULL, NULL, 'unknown', 'flag', 'catch-all: unmatched failure')
) v(priority, text_ilike, status_lo, status_hi, class, auto_action, note)
WHERE NOT EXISTS (SELECT 1 FROM public.job_failure_patterns);

-- 2. job_health_overrides: retry_safe + report_period ----------------------------------
ALTER TABLE public.job_health_overrides ADD COLUMN IF NOT EXISTS retry_safe boolean NOT NULL DEFAULT false;
ALTER TABLE public.job_health_overrides ADD COLUMN IF NOT EXISTS report_period text
  CHECK (report_period IN ('day','week','month'));

-- 3. state tables ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_doctor_retries (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_date      date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/London')::date,
  jobname       text NOT NULL,
  classified_as text,
  original_error text,
  retry_fired   boolean NOT NULL DEFAULT false,
  retry_result  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_date, jobname)
);
CREATE TABLE IF NOT EXISTS public.job_doctor_open_issues (
  jobname     text PRIMARY KEY,
  class       text,
  last_error  text,
  first_seen  date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/London')::date,
  last_seen   date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/London')::date,
  resolved    boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 4. RPCs ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.job_doctor_collect()
 RETURNS TABLE(jobname text, kind text, status_code int, last_error text, class text, auto_action text, retry_safe boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','cron' SET statement_timeout TO '60s'
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
  WHERE c.rn = 1 AND coalesce(o.ignore, false) = false;
$function$;

-- Guarded re-fire: refuses anything not marked retry_safe.
CREATE OR REPLACE FUNCTION public.job_doctor_refire(p_jobname text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','cron'
AS $function$
DECLARE v_cmd text; v_safe boolean;
BEGIN
  SELECT retry_safe INTO v_safe FROM public.job_health_overrides WHERE jobname = p_jobname;
  IF NOT coalesce(v_safe, false) THEN RETURN 'refused: not retry_safe'; END IF;
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = p_jobname AND active;
  IF v_cmd IS NULL THEN RETURN 'refused: job not found or inactive'; END IF;
  EXECUTE v_cmd;
  RETURN 'refired';
END;
$function$;

-- 5. Override seed: retry_safe (reports/polls/snapshots/health only), report_period,
--    and the kkh-trueup standing job (retry_safe=false — it writes stock). --------------
INSERT INTO public.job_health_overrides (jobname, max_gap, ignore, retry_safe, report_period, note) VALUES
 ('poll-mintsoft-status-counts-day', NULL, false, true, NULL, 'retry_safe: status-count poll'),
 ('poll-mintsoft-status-counts-night', NULL, false, true, NULL, 'retry_safe: status-count poll'),
 ('order-status-snapshot-am', NULL, false, true, NULL, 'retry_safe: snapshot'),
 ('order-status-snapshot-pm', NULL, false, true, NULL, 'retry_safe: snapshot'),
 ('mintsoft-backorder-age-snapshot-daily', NULL, false, true, NULL, 'retry_safe: snapshot'),
 ('amazon-nightly-sales-traffic', NULL, false, true, NULL, 'retry_safe: SP-API snapshot'),
 ('amazon-nightly-sales-traffic-catchup', NULL, false, true, NULL, 'retry_safe: SP-API snapshot'),
 ('amazon-nightly-orders', NULL, false, true, NULL, 'retry_safe: SP-API snapshot'),
 ('amazon-nightly-fba-inventory', NULL, false, true, NULL, 'retry_safe: SP-API snapshot'),
 ('amazon-nightly-inbound-shipments', NULL, false, true, NULL, 'retry_safe: SP-API snapshot'),
 ('amazon-nightly-finances', NULL, false, true, NULL, 'retry_safe: SP-API snapshot'),
 ('amazon-weekly-st-gap-heal', interval '8 days', false, true, NULL, 'retry_safe: snapshot gap-heal (idempotent by date)'),
 ('late-skus-weekly-email-wed', NULL, false, true, 'week', 'retry_safe: report email'),
 ('weekly-missing-cost-list-monday', NULL, false, true, 'week', 'retry_safe: report email'),
 ('weekly-ops-report', NULL, false, true, 'week', 'retry_safe: report email'),
 ('orin-daily', NULL, false, true, 'day', 'retry_safe: report email'),
 ('orin-weekly', NULL, false, true, 'week', 'retry_safe: report email'),
 ('orin-monthly', NULL, false, true, 'month', 'retry_safe: report email'),
 ('dirt-run-health-weekly', NULL, false, true, 'week', 'retry_safe: health report'),
 ('supplier-feed-watchdog-daily', NULL, false, true, NULL, 'retry_safe: health check'),
 ('amazon-cron-health-check', NULL, false, true, NULL, 'retry_safe: health check'),
 ('job-health-alert-daily', NULL, false, true, NULL, 'retry_safe: health check'),
 ('kkh-trueup-daily', interval '30 hours', false, false, NULL, 'Daily 10:15 KKH WH6 true-up; acts only on open feed_write_failed anomalies, caps at 50/run; retry_safe=false (writes stock)')
ON CONFLICT (jobname) DO UPDATE
SET retry_safe = EXCLUDED.retry_safe,
    report_period = EXCLUDED.report_period;

-- 6. Crons (bearer sourced at run time from an existing HTTP cron — no JWT in the repo) --
SELECT cron.schedule('hub-job-doctor-daily', '20 7 * * *', $cmd$
  SELECT public.cron_http_post('hub-job-doctor',
    url:='https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/hub-job-doctor',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(SELECT substring(command from 'Bearer ([A-Za-z0-9._-]+)') FROM cron.job WHERE jobname='backfill-tracking-numbers-every-5min' LIMIT 1)),
    body:='{}'::jsonb, timeout_milliseconds:=120000);
$cmd$);

SELECT cron.schedule('kkh-trueup-daily', '15 10 * * *', $cmd$
  SELECT public.cron_http_post('kkh-trueup-daily',
    url:='https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/kkh-trueup',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(SELECT substring(command from 'Bearer ([A-Za-z0-9._-]+)') FROM cron.job WHERE jobname='backfill-tracking-numbers-every-5min' LIMIT 1)),
    body:='{}'::jsonb, timeout_milliseconds:=180000);
$cmd$);
