-- ============================================================================
-- Opportunities O1 — listing-readiness flags on the Unlisted report. Per SKU,
-- can we fill the GTC template's hard fields? Category (via the eBay category
-- map), Image (product_images), Dims (weight+h+l+d), Barcode (EAN/UPC), Brand.
-- Price is already guaranteed (the report filters cost_price > 0). ready_score
-- 0–5; a SKU is "ready to list" at 5.
-- ============================================================================
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
      (public.get_sku_ebay_category(pc.sku) IS NOT NULL) AS has_category,
      EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = pc.id) AS has_image,
      (COALESCE(pc.weight,0) > 0 AND COALESCE(pc.height,0) > 0 AND COALESCE(pc.length,0) > 0 AND COALESCE(pc.depth,0) > 0) AS has_dims,
      (pc.barcode IS NOT NULL AND length(btrim(pc.barcode)) > 0) AS has_barcode,
      (pc.brand_id IS NOT NULL) AS has_brand
    FROM products_cache pc
    LEFT JOIN brands b ON b.id = pc.brand_id
    WHERE COALESCE(pc.discontinued, false) = false
      AND COALESCE(pc.quarantined, false) = false
      AND pc.current_stock > 0
      AND pc.cost_price > 0
      AND (pc.current_stock * pc.cost_price) >= min_capital
      AND NOT EXISTS (SELECT 1 FROM listing_coverage lc WHERE lc.sku = pc.sku AND lc.channel = 'ebay' AND lc.status = 'Active')
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
