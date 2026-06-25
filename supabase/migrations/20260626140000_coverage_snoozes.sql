-- ============================================================================
-- Opportunities — snooze/dismiss an unlisted SKU with a REASON + DURATION.
-- e.g. "won't sell as a single" → staff judgement the system can't infer.
-- Snoozed SKUs drop off the Unlisted report until snooze_until passes
-- (NULL = forever). Reuses the readiness function (rebuilt to exclude snoozes).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coverage_snoozes (
  sku          text PRIMARY KEY,
  reason       text,
  snooze_until timestamptz,            -- NULL = forever
  snoozed_by   uuid,
  snoozed_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.coverage_snoozes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read coverage_snoozes"  ON public.coverage_snoozes;
CREATE POLICY "auth read coverage_snoozes"  ON public.coverage_snoozes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write coverage_snoozes" ON public.coverage_snoozes;
CREATE POLICY "auth write coverage_snoozes" ON public.coverage_snoozes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Active snoozes (for the management view + un-snooze).
CREATE OR REPLACE FUNCTION public.get_coverage_snoozes()
RETURNS TABLE(sku text, product_name text, reason text, snooze_until timestamptz, snoozed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT cs.sku, pc.name, cs.reason, cs.snooze_until, cs.snoozed_at
  FROM coverage_snoozes cs
  LEFT JOIN products_cache pc ON pc.sku = cs.sku
  WHERE cs.snooze_until IS NULL OR cs.snooze_until > now()
  ORDER BY cs.snoozed_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_coverage_snoozes() TO authenticated;

-- Rebuild the Unlisted report to exclude active snoozes.
DROP FUNCTION IF EXISTS public.get_ebay_unlisted_skus(numeric, integer);
CREATE OR REPLACE FUNCTION public.get_ebay_unlisted_skus(
  min_capital numeric DEFAULT 25,
  limit_n     integer DEFAULT 500
)
RETURNS TABLE(
  sku text, product_name text, brand_name text,
  current_stock numeric, cost_price numeric, capital_tied numeric,
  velocity_per_week numeric, units_sold_90d integer, last_sold date, priority text,
  has_category boolean, has_image boolean, has_dims boolean, has_barcode boolean, has_brand boolean,
  ready_score integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT
      pc.id, pc.sku, pc.name, b.name AS brand_name, pc.current_stock, pc.cost_price,
      COALESCE(pc.velocity_per_week, 0) AS velocity_per_week, pc.units_sold_90d,
      (COALESCE(d.ebay_category_id, public.get_sku_ebay_category(pc.sku)) IS NOT NULL) AS has_category,
      EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = pc.id) AS has_image,
      (COALESCE(pc.weight,0) > 0 AND COALESCE(pc.height,0) > 0 AND COALESCE(pc.length,0) > 0 AND COALESCE(pc.depth,0) > 0) AS has_dims,
      (pc.barcode IS NOT NULL AND length(btrim(pc.barcode)) > 0) AS has_barcode,
      (pc.brand_id IS NOT NULL) AS has_brand
    FROM products_cache pc
    LEFT JOIN brands b ON b.id = pc.brand_id
    LEFT JOIN listing_drafts d ON d.sku = pc.sku
    WHERE COALESCE(pc.discontinued, false) = false
      AND COALESCE(pc.quarantined, false) = false
      AND pc.current_stock > 0
      AND pc.cost_price > 0
      AND (pc.current_stock * pc.cost_price) >= min_capital
      AND NOT EXISTS (SELECT 1 FROM listing_coverage lc WHERE lc.sku = pc.sku AND lc.channel = 'ebay' AND lc.status = 'Active')
      AND NOT EXISTS (SELECT 1 FROM coverage_snoozes cs WHERE cs.sku = pc.sku AND (cs.snooze_until IS NULL OR cs.snooze_until > now()))
  )
  SELECT
    base.sku, base.name, base.brand_name, base.current_stock, base.cost_price,
    round(base.current_stock * base.cost_price, 2) AS capital_tied,
    base.velocity_per_week, base.units_sold_90d,
    (SELECT max(ol.order_date)::date FROM order_lines ol WHERE ol.sku = base.sku) AS last_sold,
    CASE
      WHEN COALESCE(base.units_sold_90d, 0) > 0 OR (base.current_stock * base.cost_price) >= 200 THEN 'high'
      WHEN (base.current_stock * base.cost_price) >= 50 THEN 'medium'
      ELSE 'low'
    END AS priority,
    base.has_category, base.has_image, base.has_dims, base.has_barcode, base.has_brand,
    (base.has_category::int + base.has_image::int + base.has_dims::int + base.has_barcode::int + base.has_brand::int) AS ready_score
  FROM base
  ORDER BY capital_tied DESC
  LIMIT GREATEST(limit_n, 1);
$$;
GRANT EXECUTE ON FUNCTION public.get_ebay_unlisted_skus(numeric, integer) TO authenticated;
