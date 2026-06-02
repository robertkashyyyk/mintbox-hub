-- Nightly incremental ingestion of 3DS eBay orders.
--
-- Calls the ingest-3ds-orders edge function once a day in "incremental" mode so
-- threeds_order_transactions / threeds_listings stay current without manual runs.
--
-- TIMEZONE: pg_cron runs in UTC on Supabase. '0 23 * * *' = 23:00 UTC, which is
--   11pm UK in winter (GMT) and midnight UK in summer (BST). For a nightly data
--   sync the exact hour is immaterial; adjust if you want exactly 11pm year-round.
--
-- AUTH: ingest-3ds-orders gates on a service_role bearer (verify_jwt=false, but
--   the function checks the token itself). The anon key will NOT pass. Replace
--   <SERVICE_ROLE_KEY> below with the project's service_role key before running.
--   (Kept as a placeholder here so the real secret is never committed to git.)

-- pg_cron and pg_net are already enabled on this project (other crons use them).
-- Do NOT re-run CREATE EXTENSION: it re-triggers pg_cron's after-create grant
-- script and fails with "2BP01: dependent privileges exist".

SELECT cron.schedule(
  'ingest-3ds-orders-nightly',
  '0 23 * * *',
  $$
    SELECT net.http_post(
      url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/ingest-3ds-orders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body := jsonb_build_object('mode', 'incremental', 'triggered_by', 'cron'),
      timeout_milliseconds := 120000
    ) AS request_id;
  $$
);
