-- Security Advisor remediation — Phase 1 (clear the 21 ERRORs → healthy) + safe
-- Phase 3 hygiene. Internal staff tool: all logged-in (authenticated) staff may
-- read everything; the public anon key should not reach business data.
--
-- This is SAFE for authenticated users but SMOKE-TEST after applying: open the
-- staff pages that read the flipped views (Courier Margin, Carrier Settings,
-- Ops/backorder pages, eBay performance, SKU pages, repricer) and the public
-- /products page. A view that goes blank means its base table lacks an
-- authenticated SELECT policy — fixable with a one-line policy add.
-- Rollback for any view: ALTER VIEW <name> RESET (security_invoker);

-- ---------------------------------------------------------------------------
-- 1. RLS on the one unprotected table (mirror courier_rates' policy pattern so
--    Carrier Settings can still read AND edit it).
-- ---------------------------------------------------------------------------
ALTER TABLE public.carrier_format_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read carrier_format_services"  ON public.carrier_format_services;
DROP POLICY IF EXISTS "staff write carrier_format_services" ON public.carrier_format_services;
DROP POLICY IF EXISTS "service all carrier_format_services" ON public.carrier_format_services;
CREATE POLICY "auth read carrier_format_services"  ON public.carrier_format_services FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff write carrier_format_services" ON public.carrier_format_services FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service all carrier_format_services" ON public.carrier_format_services FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 2. Flip the 20 SECURITY DEFINER views to security_invoker so they respect the
--    caller's RLS instead of bypassing it.
-- ---------------------------------------------------------------------------
ALTER VIEW public.buy_recommendations            SET (security_invoker = on);
ALTER VIEW public.ebay_odr_with_tdr              SET (security_invoker = on);
ALTER VIEW public.image_scout_duplicate_images   SET (security_invoker = on);
ALTER VIEW public.menu_for_user                  SET (security_invoker = on);
ALTER VIEW public.ops_backorder_daily_delta      SET (security_invoker = on);
ALTER VIEW public.ops_backorder_weekly_summary   SET (security_invoker = on);
ALTER VIEW public.ops_exceptions_today           SET (security_invoker = on);
ALTER VIEW public.order_status_snapshot_latest   SET (security_invoker = on);
ALTER VIEW public.order_status_snapshot_today    SET (security_invoker = on);
ALTER VIEW public.order_telemetry_open_lines     SET (security_invoker = on);
ALTER VIEW public.products_needs_enrichment      SET (security_invoker = on);
ALTER VIEW public.sku_master_v                   SET (security_invoker = on);
ALTER VIEW public.sku_relationships              SET (security_invoker = on);
ALTER VIEW public.threeds_listings               SET (security_invoker = on);
ALTER VIEW public.vw_orphan_skus                 SET (security_invoker = on);
-- my own views (should have had this from the start):
ALTER VIEW public.v_8020_courier                 SET (security_invoker = on);
ALTER VIEW public.v_8020_courier_global          SET (security_invoker = on);
ALTER VIEW public.v_8020_intl_orders             SET (security_invoker = on);
ALTER VIEW public.v_8020_tx                      SET (security_invoker = on);
ALTER VIEW public.v_8020_weekly                  SET (security_invoker = on);

-- ---------------------------------------------------------------------------
-- 3. Phase 3 hygiene — pin search_path on the two SECURITY DEFINER functions
--    that lacked it (prevents search_path injection).
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.create_ebay_odr_task()           SET search_path = public;
ALTER FUNCTION public.create_ebay_response_time_task() SET search_path = public;

-- ---------------------------------------------------------------------------
-- 4. Lock the public anon key out of the staff-only report/snapshot data I added
--    (scope reads to authenticated; revoke anon execute on the report functions).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "profit_8020_weekly read" ON public.profit_8020_weekly;
CREATE POLICY "profit_8020_weekly read" ON public.profit_8020_weekly FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "stock_snapshot read" ON public.stock_snapshot;
CREATE POLICY "stock_snapshot read" ON public.stock_snapshot FOR SELECT TO authenticated USING (true);

REVOKE EXECUTE ON FUNCTION public.get_8020_leaderboard(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.capture_profit_8020_week(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_profit_band_history()      FROM anon;
REVOKE EXECUTE ON FUNCTION public.capture_stock_snapshot()       FROM anon;
