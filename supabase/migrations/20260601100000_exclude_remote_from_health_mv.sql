-- Rebuild sku_stock_health MV to exclude remote (15D) SKUs.
-- "15D" in a product name indicates stock held at a remote/dropship warehouse,
-- not at the Coleraine live warehouse. These should be excluded from all health
-- analysis, scope counts, and stock valuation.
--
-- Also rebuilds dependent objects:
--   - sku_health_summary_cache (summary MV used by get_stock_health_summary RPC)
--   - buy_recommendations (view that reads from sku_stock_health)
--
-- Migration housekeeping: this file also formalises two previously-applied changes:
--   - GRANT SELECT on sku_stock_health to authenticated (was lost in May 7 migration)
--   - sku_health_summary_cache creation (created directly via API on 2026-05-31)

-- ── Step 1: Drop dependent objects ─────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.sku_health_summary_cache;
DROP VIEW IF EXISTS public.buy_recommendations;
DROP MATERIALIZED VIEW IF EXISTS public.sku_stock_health;

-- ── Step 2: Rebuild sku_stock_health excluding remote (15D) SKUs ───────────────
CREATE MATERIALIZED VIEW public.sku_stock_health AS
WITH base AS (
  SELECT
    p.sku,
    p.brand_id,
    COALESCE(v.avg_weekly_units, 0) AS avg_weekly_units,
    COALESCE(p.current_stock, 0)    AS on_hand_qty,
    b.base_multiplier
  FROM public.products_cache p
  LEFT JOIN public.sku_velocity v ON v.sku = p.sku
  LEFT JOIN public.brands b       ON b.id  = p.brand_id
  WHERE NOT (p.name ILIKE '15D%')                    -- exclude remote/dropship stock
    AND COALESCE(p.discontinued, false) = false       -- exclude discontinued products
),
calc AS (
  SELECT
    sku, brand_id, avg_weekly_units, on_hand_qty, base_multiplier,
    CASE WHEN avg_weekly_units = 0 THEN NULL
         ELSE (on_hand_qty::numeric / avg_weekly_units)
    END AS weeks_of_cover
  FROM base
)
SELECT
  sku, brand_id, avg_weekly_units, on_hand_qty, base_multiplier, weeks_of_cover,
  CASE
    WHEN on_hand_qty = 0 AND avg_weekly_units = 0 THEN 'Non Selling'
    WHEN on_hand_qty = 0 AND avg_weekly_units > 0 THEN 'Out of Stock'
    WHEN base_multiplier IS NULL               THEN 'Missing Baseline'
    WHEN avg_weekly_units = 0                  THEN 'Dead Stock'
    WHEN weeks_of_cover IS NULL                THEN 'Unknown'
    WHEN weeks_of_cover >= base_multiplier * 13 THEN 'Extreme Overstock'
    WHEN weeks_of_cover >= base_multiplier * 4  THEN 'Overstock'
    WHEN weeks_of_cover >= base_multiplier * 2  THEN 'Unhealthy'
    WHEN weeks_of_cover >= base_multiplier      THEN 'Healthy'
    WHEN weeks_of_cover >= base_multiplier * 0.5 THEN 'Low Stock'
    WHEN weeks_of_cover > 0                     THEN 'Critical'
    ELSE 'Unknown'
  END AS health_category
FROM calc;

CREATE UNIQUE INDEX idx_sku_stock_health_sku    ON public.sku_stock_health (sku);
CREATE INDEX        idx_sku_stock_health_brand  ON public.sku_stock_health (brand_id);
CREATE INDEX        idx_sku_stock_health_health ON public.sku_stock_health (health_category);

REFRESH MATERIALIZED VIEW public.sku_stock_health;

GRANT SELECT ON public.sku_stock_health TO authenticated;

-- ── Step 3: Rebuild sku_health_summary_cache ───────────────────────────────────
CREATE MATERIALIZED VIEW public.sku_health_summary_cache AS
SELECT
  COALESCE(health_category, 'Unknown') AS health_category,
  brand_id,
  COUNT(*)::bigint                     AS sku_count,
  SUM(on_hand_qty)::numeric            AS total_on_hand
FROM public.sku_stock_health
GROUP BY health_category, brand_id;

CREATE INDEX idx_shsc_brand ON public.sku_health_summary_cache (brand_id);
CREATE INDEX idx_shsc_cat   ON public.sku_health_summary_cache (health_category);

GRANT SELECT ON public.sku_health_summary_cache TO authenticated, service_role;

REFRESH MATERIALIZED VIEW public.sku_health_summary_cache;

-- ── Step 4: Restore buy_recommendations view ───────────────────────────────────
CREATE OR REPLACE VIEW public.buy_recommendations AS
SELECT
  sku, brand_id, avg_weekly_units, on_hand_qty,
  base_multiplier, weeks_of_cover,
  avg_weekly_units * (base_multiplier * 2::numeric)                        AS target_stock,
  avg_weekly_units * (base_multiplier * 2::numeric) - on_hand_qty          AS recommended_purchase_qty
FROM public.sku_stock_health s
WHERE base_multiplier IS NOT NULL
  AND avg_weekly_units > 0
  AND (avg_weekly_units * (base_multiplier * 2::numeric) - on_hand_qty) > 0;

-- ── Step 5: get_stock_health_summary — ensure it stays on the summary cache ────
-- (Re-apply in case the function was ever reverted to the slow version)
CREATE OR REPLACE FUNCTION public.get_stock_health_summary(
  p_brand_id     uuid    DEFAULT NULL,
  p_exclude_dirt boolean DEFAULT false
)
RETURNS TABLE (
  total_skus    bigint,
  dirt_skus     bigint,
  total_on_hand numeric,
  by_category   jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH
  dirt AS (
    SELECT sku FROM public.products_cache WHERE quarantined = true
  ),
  scoped AS (
    SELECT
      h.health_category,
      h.on_hand_qty,
      (d.sku IS NOT NULL) AS is_dirt
    FROM public.sku_stock_health h
    LEFT JOIN dirt d ON d.sku = h.sku
    WHERE (p_brand_id IS NULL OR h.brand_id = p_brand_id)
      AND (NOT p_exclude_dirt OR d.sku IS NULL)
  ),
  cats AS (
    SELECT health_category, COUNT(*)::bigint AS n
    FROM scoped
    GROUP BY health_category
  )
  SELECT
    (SELECT COUNT(*)::bigint FROM scoped)                                       AS total_skus,
    (SELECT COUNT(*)::bigint  FROM scoped WHERE is_dirt)                        AS dirt_skus,
    COALESCE((SELECT SUM(on_hand_qty) FROM scoped), 0)::numeric                 AS total_on_hand,
    COALESCE(
      (SELECT jsonb_object_agg(COALESCE(health_category, 'Unknown'), n) FROM cats),
      '{}'::jsonb
    )                                                                            AS by_category;
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_health_summary(uuid, boolean) TO authenticated;
