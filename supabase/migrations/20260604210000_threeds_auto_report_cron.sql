-- Hourly trigger for the 3D Reprice Auto-Report snapshot.
--
-- The cron fires every hour; the edge function itself checks the configured
-- London run-hour (DST-aware, soft-coded in app_settings 'reprice.auto_report')
-- and only generates the snapshot at that hour, once per day. Hourly (vs a fixed
-- UTC time) keeps the run-hour setting authoritative and handles BST/GMT.
--
-- pg_cron + pg_net already enabled (do NOT re-run CREATE EXTENSION — 2BP01).
-- Replace <SERVICE_ROLE_KEY> with the project's service_role key.

SELECT cron.schedule(
  'threeds-auto-report-hourly',
  '5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/threeds-reprice-auto-snapshot',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body := jsonb_build_object('triggered_by', 'cron'),
      timeout_milliseconds := 120000
    ) AS request_id;
  $$
);
