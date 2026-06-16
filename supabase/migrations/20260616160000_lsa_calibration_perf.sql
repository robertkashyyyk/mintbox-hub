-- Speed up get_lsa_calibration (the brand-detail LSA page was ~10s and intermittently
-- timing out → blank/retry). Two causes:
--   1. No index on products_cache(brand_id) → the brand filter Parallel-Seq-Scanned 225k rows.
--   2. The brand filter was applied LAST (after computing velocity + base for the WHOLE
--      catalogue), so passing a brand_id didn't reduce the work.
-- Fix: add the brand_id index, and push the brand filter DOWN into the sales + base CTEs so
-- only that brand's ~hundred products are processed. Brand page drops from ~10s to sub-second.

CREATE INDEX IF NOT EXISTS idx_products_cache_brand_id ON public.products_cache (brand_id);

CREATE OR REPLACE FUNCTION public.get_lsa_calibration(
  p_brand_id uuid DEFAULT NULL::uuid,
  p_limit int DEFAULT 1000,
  p_offset int DEFAULT 0
)
 RETURNS TABLE(sku text, product_name text, brand_id uuid, brand_name text, supplier_id uuid, supplier_name text, current_stock numeric, current_lsa numeric, weekly_velocity numeric, base_multiplier numeric, target_lsa numeric, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (value)::int FROM app_settings WHERE key = 'lsa.weekly_window_weeks'), 4) AS weeks,
      COALESCE((SELECT (value)::numeric FROM app_settings WHERE key = 'lsa.global_base_multiplier'), 4) AS global_mult,
      COALESCE((SELECT (value)::int FROM app_settings WHERE key = 'lsa.min_threshold'), 1) AS lsa_min,
      COALESCE((SELECT (value->>'critical')::numeric FROM app_settings WHERE key = 'lsa.tolerance'), 0.5) AS t_crit,
      COALESCE((SELECT (value->>'low')::numeric      FROM app_settings WHERE key = 'lsa.tolerance'), 0.85) AS t_low,
      COALESCE((SELECT (value->>'high')::numeric     FROM app_settings WHERE key = 'lsa.tolerance'), 1.15) AS t_high,
      COALESCE((SELECT (value->>'excess')::numeric   FROM app_settings WHERE key = 'lsa.tolerance'), 1.5)  AS t_excess
  ),
  sales AS (
    SELECT ol.sku, SUM(ol.qty)::numeric AS units
    FROM order_lines ol, cfg
    WHERE ol.order_date >= now() - (cfg.weeks || ' weeks')::interval
      AND ol.order_date >= '2026-01-01'::timestamptz
      -- scope the order_lines aggregate to the brand's SKUs when a brand is given
      AND (p_brand_id IS NULL OR ol.sku IN (SELECT sku FROM products_cache WHERE brand_id = p_brand_id))
    GROUP BY ol.sku
  ),
  base AS (
    SELECT
      pc.sku,
      pc.name AS product_name,
      pc.brand_id,
      b.name AS brand_name,
      sp.supplier_id,
      s.name AS supplier_name,
      COALESCE(pc.current_stock, 0)::numeric AS current_stock,
      COALESCE(pc.low_stock_alert_level, 0)::numeric AS current_lsa,
      ROUND(COALESCE(sales.units, 0) / NULLIF(cfg.weeks, 0)::numeric, 2) AS weekly_velocity,
      COALESCE(b.base_multiplier, cfg.global_mult)::numeric AS base_multiplier,
      cfg.t_crit, cfg.t_low, cfg.t_high, cfg.t_excess
    FROM products_cache pc
    LEFT JOIN brands b ON b.id = pc.brand_id
    LEFT JOIN sku_prefixes sp ON sp.prefix = upper(split_part(
      pc.sku, CASE WHEN pc.sku LIKE '%/%' THEN '/' ELSE '-' END, 1))
    LEFT JOIN suppliers s ON s.id = sp.supplier_id
    LEFT JOIN sales ON sales.sku = pc.sku
    CROSS JOIN cfg
    WHERE COALESCE(pc.quarantined, false) = false
      AND COALESCE(pc.discontinued, false) = false
      AND pc.mintsoft_product_id IS NOT NULL
      AND COALESCE(pc.low_stock_alert_level, 0) > cfg.lsa_min
      AND (p_brand_id IS NULL OR pc.brand_id = p_brand_id)   -- pushed down (uses the new index)
  ),
  scored AS (
    SELECT
      *,
      ROUND(weekly_velocity * base_multiplier)::numeric AS target_lsa
    FROM base
  )
  SELECT
    sku, product_name, brand_id, brand_name, supplier_id, supplier_name,
    current_stock, current_lsa, weekly_velocity, base_multiplier, target_lsa,
    CASE
      WHEN target_lsa = 0 AND current_lsa = 0 THEN 'target'
      WHEN target_lsa = 0 AND current_lsa > 0 THEN 'excess'
      WHEN current_lsa < target_lsa * t_crit   THEN 'critical'
      WHEN current_lsa < target_lsa * t_low    THEN 'low'
      WHEN current_lsa <= target_lsa * t_high  THEN 'target'
      WHEN current_lsa <= target_lsa * t_excess THEN 'high'
      ELSE 'excess'
    END AS status
  FROM scored
  LIMIT p_limit OFFSET p_offset;
$function$;
