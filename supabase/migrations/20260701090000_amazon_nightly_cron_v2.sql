-- ============================================================================
-- 20260701090000_amazon_nightly_cron_v2.sql
-- Durable nightly cron for the WHOLE FBA pipeline. Supersedes the earlier cron
-- (which was never applied and omitted orders). Uses rolling 7-day windows for
-- orders + finances so a single missed night self-heals; S&T pulls yesterday +
-- the day before for the same reason.
--
-- REPLACE <SERVICE_ROLE_KEY> (find-and-replace ALL 6) with your service_role key
-- before running. pg_cron + pg_net are already enabled.
-- ============================================================================

-- Clear any prior amazon-* jobs so this is the single source of truth.
DO $$ DECLARE j text; BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE jobname LIKE 'amazon-%' LOOP
    PERFORM cron.unschedule(j);
  END LOOP;
END $$;

-- 02:00  Sales & Traffic — yesterday
SELECT cron.schedule('amazon-nightly-sales-traffic', '0 2 * * *', $$
  SELECT net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-pull-sales-traffic',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body := jsonb_build_object('triggered_by','cron'),
    timeout_milliseconds := 150000);
$$);

-- 02:05  Sales & Traffic — day before yesterday (self-heals a single missed night)
SELECT cron.schedule('amazon-nightly-sales-traffic-catchup', '5 2 * * *', $$
  SELECT net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-pull-sales-traffic',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body := jsonb_build_object('day', (current_date - 2)::text, 'triggered_by','cron'),
    timeout_milliseconds := 150000);
$$);

-- 02:10  Orders — rolling last 7 days (was MISSING before; this is why data froze)
SELECT cron.schedule('amazon-nightly-orders', '10 2 * * *', $$
  SELECT net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-pull-orders',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body := jsonb_build_object('triggered_by','cron'),
    timeout_milliseconds := 150000);
$$);

-- 02:15  FBA inventory snapshot — current
SELECT cron.schedule('amazon-nightly-fba-inventory', '15 2 * * *', $$
  SELECT net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-pull-fba-inventory',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body := jsonb_build_object('triggered_by','cron'),
    timeout_milliseconds := 150000);
$$);

-- 02:25  Finances — rolling last 7 days (catches late-posting settlements)
SELECT cron.schedule('amazon-nightly-finances', '25 2 * * *', $$
  SELECT net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-pull-finances',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>'),
    body := jsonb_build_object('triggered_by','cron'),
    timeout_milliseconds := 150000);
$$);

-- 03:00  Rebuild ASIN->SKU map, then refresh the economics matview
SELECT cron.schedule('amazon-nightly-refresh', '0 3 * * *', $$
  SELECT public.amazon_rebuild_sku_map();
  SELECT public.amazon_refresh_economics();
$$);
