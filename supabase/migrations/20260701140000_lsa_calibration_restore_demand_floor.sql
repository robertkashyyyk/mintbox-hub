-- REGRESSION FIX: get_lsa_calibration was ignoring every SKU sitting at the LSA floor.
--
-- 20260602150200 deliberately widened the WHERE to `(low_stock_alert_level > 0 OR
-- sales.units > 0)` so that products left at the Mintsoft default LSA of 1 but with real
-- demand would still be surfaced (and calibrated up off the floor). The 20260616160000
-- perf rewrite silently dropped the `OR sales.units > 0` half, reverting to a bare
-- `low_stock_alert_level > cfg.lsa_min`. 20260616180000 carried that forward.
--
-- Effect of the regression: any SKU at LSA = 1 (= lsa_min) was filtered out BEFORE
-- classification, so the auto-LSA function (which drives off this RPC's candidate list)
-- never saw it, no matter how well it sold. The lsa_brand_summary MV — which does NOT have
-- this clause — correctly flagged them "critical", producing the tile-vs-live divergence
-- (e.g. NGK showing 61 critical the auto-function could never clear; NGK-05030 at LSA 1 on
-- 48 units/12wk). The function only ever ADJUSTED already-set LSAs; it never LIFTED one off
-- the floor.
--
-- Fix: restore the demand escape hatch. `sales` is already LEFT JOINed and brand-scoped, and
-- the unconditional `pc.brand_id = p_brand_id` filter is retained, so the brand index is
-- still used and there is no perf regression.

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
      AND ol.sku IN (SELECT sku FROM products_cache WHERE brand_id = p_brand_id)
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
      -- RESTORED: surface floor-LSA items that have demand, so they get calibrated up.
      AND (COALESCE(pc.low_stock_alert_level, 0) > cfg.lsa_min OR COALESCE(sales.units, 0) > 0)
      AND pc.brand_id = p_brand_id     -- unconditional → uses idx_products_cache_brand_id
  ),
  scored AS (
    SELECT *, ROUND(weekly_velocity * base_multiplier)::numeric AS target_lsa FROM base
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
