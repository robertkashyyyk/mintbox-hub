-- ============================================================================
-- LSA clearance ring-fence.
--
-- Problem: a SKU put on a Sale or Liquidation (a clearance campaign) sells FASTER
-- because it's discounted. Those clearance orders land in order_lines like any
-- other sale, so get_lsa_calibration's `sales` CTE counts them → weekly_velocity
-- rises → target_lsa (= velocity × base_multiplier) rises → auto-update-lsa-cron
-- pushes a HIGHER low_stock_alert_level to Mintsoft → the buy engine treats
-- LSA > lsa.min_threshold as a reorder point → we PHANTOM-REBUY the exact dead
-- stock we're trying to clear, at demand that only existed because of the discount.
--
-- The dead-stock trim (20260701150000) only covers the OUT-OF-STOCK-dead case.
-- Clearance items are IN STOCK and actively (discount-)selling, so nothing today
-- stops their LSA being driven up. This is the missing half.
--
-- Fix — ring-fence LSA from clearance the same way price is ring-fenced from the
-- repricer. Only the CLEARANCE intents (type in 'sale','liquidation') are affected;
-- price-tests (promo/elasticity) on healthy stock are left alone.
--
--   1. Exclude clearance-WINDOW sales from weekly_velocity. Any order_line that
--      fell inside a sale/liquidation campaign's [start_date, end_date] window for
--      that SKU is discount demand, not real demand — don't count it. This also
--      kills the ~4-week rolling-window lag AFTER a campaign ends (the discounted
--      weeks no longer inflate velocity until they age out).
--   2. While a clearance campaign is ACTIVE, force target_lsa = 0. The cron coerces
--      target 0 → floor (1) and, because clearance items are in-stock, its OOS-lower
--      guard doesn't block the trim → LSA is driven to the floor → effective_lsa = 0
--      in the buy engine → not a reorder point. So it will NOT come back into stock
--      until the campaign ends and it rebuilds real velocity at a healthy price.
--   3. Surface a display-only 'clearance' status so the LSA Calibration page shows
--      WHY these are held at the floor. (The cron keys off target_lsa vs current_lsa,
--      not status, so this is safe.)
-- ============================================================================

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
      -- (1) don't count discount-clearance demand: drop any order that fell inside a
      -- sale/liquidation campaign window for this SKU.
      AND NOT EXISTS (
        SELECT 1 FROM price_campaigns c
        WHERE c.sku = ol.sku
          AND c.type IN ('sale','liquidation')
          AND ol.order_date::date >= c.start_date
          AND (c.end_date IS NULL OR ol.order_date::date <= c.end_date)
      )
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
      -- (2) is this SKU on an ACTIVE clearance campaign right now?
      EXISTS (
        SELECT 1 FROM price_campaigns c
        WHERE c.sku = pc.sku AND c.status = 'active' AND c.type IN ('sale','liquidation')
      ) AS in_campaign,
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
      -- surface floor-LSA items that have demand OR are on clearance (so a stale-high
      -- LSA on a clearance item still gets trimmed to the floor).
      AND (COALESCE(pc.low_stock_alert_level, 0) > cfg.lsa_min
           OR COALESCE(sales.units, 0) > 0
           OR EXISTS (SELECT 1 FROM price_campaigns c
                      WHERE c.sku = pc.sku AND c.status = 'active' AND c.type IN ('sale','liquidation')))
      AND pc.brand_id = p_brand_id     -- unconditional → uses idx_products_cache_brand_id
  ),
  scored AS (
    SELECT *,
      -- (2) hold clearance SKUs at the floor: force target 0 → cron trims LSA to min.
      CASE WHEN in_campaign THEN 0
           ELSE ROUND(weekly_velocity * base_multiplier) END::numeric AS target_lsa
    FROM base
  )
  SELECT
    sku, product_name, brand_id, brand_name, supplier_id, supplier_name,
    current_stock, current_lsa, weekly_velocity, base_multiplier, target_lsa,
    CASE
      WHEN in_campaign                         THEN 'clearance'
      WHEN target_lsa = 0 AND current_lsa = 0  THEN 'target'
      WHEN target_lsa = 0 AND current_lsa > 0  THEN 'excess'
      WHEN current_lsa < target_lsa * t_crit   THEN 'critical'
      WHEN current_lsa < target_lsa * t_low    THEN 'low'
      WHEN current_lsa <= target_lsa * t_high  THEN 'target'
      WHEN current_lsa <= target_lsa * t_excess THEN 'high'
      ELSE 'excess'
    END AS status
  FROM scored
  LIMIT p_limit OFFSET p_offset;
$function$;
