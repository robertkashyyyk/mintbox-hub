-- ============================================================================
-- Phase B.1 — Listing coverage (eBay UK) + Unlisted report foundation
-- ----------------------------------------------------------------------------
-- Coverage map of which SKUs are live on which eBay account, so we can surface
-- stock we own but can't sell. Source = 3DS GET /v1/products/listings for the
-- 5 UK eBay accounts only (foreign marketplaces are duplicates; dropped). The
-- sync edge function (separate) normalises each listing's raw SKU to the TRUE
-- internal SKU via threeds_sku_aliases before writing, so `sku` joins cleanly
-- to products_cache.
--
-- Amazon coverage (ASIN-based, from the SP-API `amazon` schema) lands in B.2 —
-- this table already carries `channel` so amazon rows can be added later.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.listing_coverage (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku          text NOT NULL,          -- TRUE internal SKU (alias-normalised)
  listing_sku  text,                   -- raw SKU as the channel reports it
  channel      text NOT NULL,          -- 'ebay' | 'amazon'
  seller_id    bigint,                 -- 3DS seller account id (eBay)
  store_name   text,                   -- e.g. 'ascgroupltd'
  marketplace  text,                   -- 'UK' etc
  item_id      text,                   -- eBay item number (or ASIN for amazon)
  status       text,                   -- 'Active' etc
  price        numeric,
  quantity     integer,
  url          text,
  source       text NOT NULL DEFAULT '3ds',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, seller_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_coverage_sku            ON public.listing_coverage(sku);
CREATE INDEX IF NOT EXISTS idx_listing_coverage_channel_status ON public.listing_coverage(channel, status);
CREATE INDEX IF NOT EXISTS idx_listing_coverage_seller         ON public.listing_coverage(seller_id);

ALTER TABLE public.listing_coverage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read listing_coverage" ON public.listing_coverage;
CREATE POLICY "auth read listing_coverage" ON public.listing_coverage
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service write listing_coverage" ON public.listing_coverage;
CREATE POLICY "service write listing_coverage" ON public.listing_coverage
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Sync bookkeeping (per channel) so the report can show freshness.
CREATE TABLE IF NOT EXISTS public.listing_coverage_sync (
  channel       text PRIMARY KEY,
  last_run_at   timestamptz,
  rows_upserted integer,
  note          text
);
ALTER TABLE public.listing_coverage_sync ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read listing_coverage_sync" ON public.listing_coverage_sync;
CREATE POLICY "auth read listing_coverage_sync" ON public.listing_coverage_sync
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "service write listing_coverage_sync" ON public.listing_coverage_sync;
CREATE POLICY "service write listing_coverage_sync" ON public.listing_coverage_sync
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- get_ebay_unlisted_skus() — stock we own that is NOT live on ANY UK eBay
-- account. Ranked by capital tied up; priority flags the genuinely valuable
-- finds (sells but unlisted = worst).
--   priority: 'high'   — has sales history (proven demand) OR ≥ £200 capital
--             'medium' — ≥ £50 capital
--             'low'    — everything else above the min_capital floor
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_ebay_unlisted_skus(
  min_capital numeric DEFAULT 25,
  limit_n     integer DEFAULT 500
)
RETURNS TABLE(
  sku text, product_name text, brand_name text,
  current_stock numeric, cost_price numeric, capital_tied numeric,
  velocity_per_week numeric, units_sold_90d integer, last_sold date,
  priority text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    pc.sku, pc.name, b.name,
    pc.current_stock, pc.cost_price,
    round(pc.current_stock * pc.cost_price, 2) AS capital_tied,
    COALESCE(pc.velocity_per_week, 0), pc.units_sold_90d,
    (SELECT max(ol.order_date)::date FROM order_lines ol WHERE ol.sku = pc.sku) AS last_sold,
    CASE
      WHEN COALESCE(pc.units_sold_90d, 0) > 0 OR (pc.current_stock * pc.cost_price) >= 200 THEN 'high'
      WHEN (pc.current_stock * pc.cost_price) >= 50 THEN 'medium'
      ELSE 'low'
    END AS priority
  FROM products_cache pc
  LEFT JOIN brands b ON b.id = pc.brand_id
  WHERE COALESCE(pc.discontinued, false) = false
    AND COALESCE(pc.quarantined, false) = false
    AND pc.current_stock > 0
    AND pc.cost_price > 0
    AND (pc.current_stock * pc.cost_price) >= min_capital
    AND NOT EXISTS (
      SELECT 1 FROM listing_coverage lc
      WHERE lc.sku = pc.sku AND lc.channel = 'ebay' AND lc.status = 'Active'
    )
  ORDER BY capital_tied DESC
  LIMIT GREATEST(limit_n, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_ebay_unlisted_skus(numeric, integer) TO authenticated;
