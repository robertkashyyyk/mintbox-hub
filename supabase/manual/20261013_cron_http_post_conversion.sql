-- 2026-10-13: cron changes for the silent-failure guard (20261013190000_job_health_guard.sql).
-- Run by hand in prod; recorded here. Bearer tokens are never written into the repo: new jobs
-- copy the token server-side from an existing job.

-- 0. Rollback source: every cron command before the conversion (service-only, holds tokens).
create schema if not exists ops_backup;
revoke all on schema ops_backup from public, anon, authenticated;
create table if not exists ops_backup.cron_job_2026_10_13 as
  select jobid, jobname, schedule, command, active, now() as captured_at from cron.job;
revoke all on table ops_backup.cron_job_2026_10_13 from public, anon, authenticated;

-- 1. Collector (job 139) and daily alert (job 140, 07:50 UTC).
select cron.schedule('cron-http-collect-5min', '*/5 * * * *', $$SELECT public.cron_http_collect();$$);
select cron.schedule('job-health-alert-daily', '50 7 * * *',
  format($cmd$SELECT public.cron_http_post('job-health-alert-daily',
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/job-health-alert',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',%L),
    body := jsonb_build_object('triggered_by','cron'));$cmd$,
    'Bearer ' || (select substring(command from 'Bearer ([A-Za-z0-9._\-]+)') from cron.job where jobid = 78)));

-- 2. Validate (EXPLAIN only, nothing runs), then convert every HTTP job:
--    net.http_post( -> public.cron_http_post('<jobname>', ...same named args...)
--    Pilot: job 106 first; the rest after its outcome was recorded as ok.
select cron.alter_job(job_id := jobid,
       command := replace(command, 'net.http_post(', 'public.cron_http_post(' || quote_literal(jobname) || ', '))
from cron.job
where active and command like '%net.http_post(%';

-- ROLLBACK (all jobs back to their pre-conversion commands):
-- select cron.alter_job(job_id := b.jobid, command := b.command)
-- from ops_backup.cron_job_2026_10_13 b join cron.job j on j.jobid = b.jobid
-- where j.command is distinct from b.command and b.command like '%net.http_post(%';
