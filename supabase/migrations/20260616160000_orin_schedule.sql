-- Orin · read grant + tunable models + cadenced schedule (Track A)

-- Read-only path for Orin: grant EXECUTE on the scorecard read surface to anon.
-- get_scorecard is SECURITY DEFINER and returns only aggregated scorecard numbers
-- (no PII, no raw operational rows), so this is the deliberate, safe read-only path
-- the Orin function uses instead of the service role. (When anon-lockdown / Phase 2
-- lands, keep this single grant as an explicit allow.)
GRANT EXECUTE ON FUNCTION public.get_scorecard(integer) TO anon;

-- Per-cadence model (tunable without redeploy)
INSERT INTO public.app_settings (key, value, description) VALUES (
  'scorecard.orin_models',
  '{"daily":"claude-haiku-4-5","weekly":"claude-sonnet-4-6","monthly":"claude-sonnet-4-6"}'::jsonb,
  'Orin report model per cadence (daily/weekly/monthly).'
) ON CONFLICT (key) DO NOTHING;

-- Cadenced Orin runs — Pattern B (net.http_post -> orin-report edge fn).
-- Target = canonical project vcfbegjpkvxkqpptyxni; auth = public anon JWT
-- (same convention as the existing threeds/order-snapshot crons).
SELECT cron.unschedule('orin-daily')   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='orin-daily');
SELECT cron.unschedule('orin-weekly')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='orin-weekly');
SELECT cron.unschedule('orin-monthly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='orin-monthly');

-- Daily 06:00 UTC — "what changed / what's on fire"
SELECT cron.schedule('orin-daily', '0 6 * * *', $job$
  SELECT net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/orin-report',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY"}'::jsonb,
    body := '{"cadence":"daily"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);

-- Weekly Mon 07:00 UTC — the week's story (after Sunday snapshots captured)
SELECT cron.schedule('orin-weekly', '0 7 * * 1', $job$
  SELECT net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/orin-report',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY"}'::jsonb,
    body := '{"cadence":"weekly"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);

-- Monthly 1st @ 08:00 UTC — direction of travel
SELECT cron.schedule('orin-monthly', '0 8 1 * *', $job$
  SELECT net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/orin-report',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY"}'::jsonb,
    body := '{"cadence":"monthly"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
