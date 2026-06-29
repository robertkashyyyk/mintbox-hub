-- ============================================================================
-- 20260630240000_amazon_fba_nightly_cron.sql
-- Nightly automation for the Amazon FBA pipeline so the replenishment page stays
-- current without manual pulls.
--
--   02:00 UTC  amazon-pull-sales-traffic   (yesterday)        edge fn
--   02:10 UTC  amazon-pull-fba-inventory   (current snapshot) edge fn
--   02:20 UTC  amazon-pull-finances        (last 7 days)      edge fn
--   03:00 UTC  rebuild ASIN->SKU map + refresh economics      SQL
--
-- AUTH: the pull functions gate on a service_role bearer. Replace
--   <SERVICE_ROLE_KEY> below with the project's service_role key before running
--   (placeholder so the real secret is never committed to git).
--
-- pg_cron and pg_net are ALREADY enabled on this project (other crons use them).
-- Do NOT CREATE EXTENSION — it re-triggers pg_cron's grant script and fails.
-- ============================================================================

-- REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run inside a transaction, and
-- pg_cron wraps each job in one — so refresh non-concurrently (brief lock at 3am
-- is harmless). Unique index is kept (no longer required, but harmless).
CREATE OR REPLACE FUNCTION public.amazon_refresh_economics()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, amazon AS $$
    REFRESH MATERIALIZED VIEW amazon.mv_sku_economics;
$$;

SELECT cron.schedule('amazon-nightly-sales-traffic', '0 2 * * *', $$
    SELECT net.http_post(
        url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-pull-sales-traffic',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>'),
        body := jsonb_build_object('triggered_by','cron'),
        timeout_milliseconds := 150000
    );
$$);

SELECT cron.schedule('amazon-nightly-fba-inventory', '10 2 * * *', $$
    SELECT net.http_post(
        url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-pull-fba-inventory',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>'),
        body := jsonb_build_object('triggered_by','cron'),
        timeout_milliseconds := 150000
    );
$$);

SELECT cron.schedule('amazon-nightly-finances', '20 2 * * *', $$
    SELECT net.http_post(
        url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-pull-finances',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>'),
        body := jsonb_build_object('triggered_by','cron'),
        timeout_milliseconds := 150000
    );
$$);

-- Rebuild the ASIN->SKU map (picks up new orders/listings), then refresh the
-- economics matview. Map first so the economics see the latest mappings.
SELECT cron.schedule('amazon-nightly-refresh', '0 3 * * *', $$
    SELECT public.amazon_rebuild_sku_map();
    SELECT public.amazon_refresh_economics();
$$);
