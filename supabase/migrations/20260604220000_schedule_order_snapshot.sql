-- Schedule the twice-daily order-status queue snapshot.
-- Captures New / OnBackOrder / AwaitingPicking / Picked counts from Mintsoft
-- into order_status_snapshots, powering the Despatch KPIs queue-health view.
--
-- UTC times chosen to stay in the correct UK AM/PM half across DST:
--   06:30 UTC = 06:30 GMT / 07:30 BST  → AM
--   16:30 UTC = 16:30 GMT / 17:30 BST  → PM
-- The function also auto-derives the slot from UK time, and we pass it
-- explicitly for determinism.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove any prior definitions (id-safe re-run)
    PERFORM cron.unschedule('order-status-snapshot-am') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'order-status-snapshot-am');
    PERFORM cron.unschedule('order-status-snapshot-pm') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'order-status-snapshot-pm');

    PERFORM cron.schedule(
      'order-status-snapshot-am',
      '30 6 * * *',
      $cron$
      SELECT net.http_post(
        url:='https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/mintsoft-order-snapshot',
        headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY"}'::jsonb,
        body:='{"slot":"AM","trigger":"cron"}'::jsonb,
        timeout_milliseconds:=120000
      );
      $cron$
    );

    PERFORM cron.schedule(
      'order-status-snapshot-pm',
      '30 16 * * *',
      $cron$
      SELECT net.http_post(
        url:='https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/mintsoft-order-snapshot',
        headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY"}'::jsonb,
        body:='{"slot":"PM","trigger":"cron"}'::jsonb,
        timeout_milliseconds:=120000
      );
      $cron$
    );
  END IF;
END;
$$;
