-- Nightly Supplier Stock Feed equalise — calls the sync-supplier-feed edge fn at
-- 02:00 UTC. The fn is DRY-RUN until app_settings.ordering.supplier_feed_live=true,
-- so this can be scheduled safely and flipped live when ready.
-- Pattern B (net.http_post with anon bearer+apikey; fn is verify_jwt=false). pg_cron
-- + pg_net already enabled — do NOT re-create the extensions.

SELECT cron.schedule('sync-supplier-feed-nightly', '0 2 * * *', $job$
  SELECT net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/sync-supplier-feed',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$job$);
