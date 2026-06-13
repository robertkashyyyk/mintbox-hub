-- Nightly snapshot of the Repricing Payoff totals into reprice_payoff_daily, for
-- the trend chart. Runs at 23:50 UTC (after the 23:00 orders ingest, so the day's
-- sales are included). pg_cron/pg_net already enabled (do NOT CREATE EXTENSION).
-- Replace <SERVICE_ROLE_KEY> with the project's service_role key.

SELECT cron.schedule(
  'reprice-payoff-daily',
  '50 23 * * *',
  $$
    SELECT net.http_post(
      url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/reprice-payoff',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <SERVICE_ROLE_KEY>'),
      body := jsonb_build_object('persist', true),
      timeout_milliseconds := 120000
    ) AS request_id;
  $$
);
