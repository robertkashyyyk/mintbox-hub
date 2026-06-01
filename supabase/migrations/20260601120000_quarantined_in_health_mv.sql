-- Add quarantined flag to sku_stock_health MV so Exclude DIRT filtering
-- is done server-side (simple .eq filter) rather than a client-side NOT IN
-- list that breaks at scale (~40k quarantined SKUs).
--
-- Also backfills quarantined=true for all SKUs where the 4th character is
-- not '-' or '/' — the canonical definition of a "dirt" SKU.

-- ── Part A: Backfill dirt SKUs ──────────────────────────────────────────────────
UPDATE public.products_cache
SET quarantined = true
WHERE SUBSTRING(sku, 4, 1) NOT IN ('-', '/')
  AND COALESCE(quarantined, false) = false;

-- ── Part B: Drop dependent objects ─────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.sku_health_summary_cache;
DROP VIEW IF EXISTS public.buy_recommendations;
DROP VIEW IF EXISTS public.stock_valuation;
DROP MATERIALIZED VIEW IF EXISTS public.sku_stock_health;

-- ── Part C: Rebuild sku_stock_health with quarantined column ───────────────────
CREATE MATERIALIZED VIEW public.sku_stock_health AS
WITH base AS (
  SELECT
    p.sku,
    p.brand_id,
    COALESCE(v.avg_weekly_units, 0)  AS avg_weekly_units,
    COALESCE(p.current_stock, 0)     AS on_hand_qty,
    b.base_multiplier,
    COALESCE(p.quarantined, false)   AS quarantined
  FROM public.products_cache p
  LEFT JOIN public.sku_velocity v ON v.sku = p.sku
  LEFT JOIN public.brands b       ON b.id  = p.brand_id
  WHERE NOT (p.name ILIKE '15D%')
    AND COALESCE(p.discontinued, false) = false
),
calc AS (
  SELECT
    sku, brand_id, avg_weekly_units, on_hand_qty, base_multiplier, quarantined,
    CASE WHEN avg_weekly_units = 0 THEN NULL
         ELSE (on_hand_qty::numeric / avg_weekly_units)
    END AS weeks_of_cover
  FROM base
)
SELECT
  sku, brand_id, avg_weekly_units, on_hand_qty, base_multiplier, weeks_of_cover,
  quarantined,
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

CREATE UNIQUE INDEX idx_sku_stock_health_sku        ON public.sku_stock_health (sku);
CREATE INDEX        idx_sku_stock_health_brand       ON public.sku_stock_health (brand_id);
CREATE INDEX        idx_sku_stock_health_health      ON public.sku_stock_health (health_category);
CREATE INDEX        idx_sku_stock_health_quarantined ON public.sku_stock_health (quarantined);

REFRESH MATERIALIZED VIEW public.sku_stock_health;

GRANT SELECT ON public.sku_stock_health TO authenticated;

-- ── Part D: Rebuild sku_health_summary_cache ───────────────────────────────────
CREATE MATERIALIZED VIEW public.sku_health_summary_cache AS
SELECT
  COALESCE(health_category, 'Unknown') AS health_category,
  brand_id,
  quarantined,
  COUNT(*)::bigint                     AS sku_count,
  SUM(on_hand_qty)::numeric            AS total_on_hand
FROM public.sku_stock_health
GROUP BY health_category, brand_id, quarantined;

CREATE INDEX idx_shsc_brand ON public.sku_health_summary_cache (brand_id);
CREATE INDEX idx_shsc_cat   ON public.sku_health_summary_cache (health_category);
CREATE INDEX idx_shsc_dirt  ON public.sku_health_summary_cache (quarantined);

GRANT SELECT ON public.sku_health_summary_cache TO authenticated, service_role;

REFRESH MATERIALIZED VIEW public.sku_health_summary_cache;

-- ── Part E: Restore buy_recommendations ────────────────────────────────────────
CREATE OR REPLACE VIEW public.buy_recommendations AS
SELECT
  sku, brand_id, avg_weekly_units, on_hand_qty,
  base_multiplier, weeks_of_cover,
  avg_weekly_units * (base_multiplier * 2::numeric)               AS target_stock,
  avg_weekly_units * (base_multiplier * 2::numeric) - on_hand_qty AS recommended_purchase_qty
FROM public.sku_stock_health
WHERE base_multiplier IS NOT NULL
  AND avg_weekly_units > 0
  AND (avg_weekly_units * (base_multiplier * 2::numeric) - on_hand_qty) > 0
  AND quarantined = false;

-- ── Part F: Restore stock_valuation ────────────────────────────────────────────
CREATE OR REPLACE VIEW public.stock_valuation
WITH (security_invoker = true) AS
SELECT
  pc.sku,
  pc.brand_id,
  b.name                                                                   AS brand_name,
  COALESCE(pc.current_stock, 0)::numeric                                   AS current_stock,
  pc.cost_price,
  (COALESCE(pc.cost_price, 0) * COALESCE(pc.current_stock, 0))::numeric    AS net_value,
  COALESCE(sh.health_category, 'Unknown')                                  AS health_category,
  pc.quarantined,
  (pc.name ILIKE '15D%')::boolean                                          AS is_remote
FROM public.products_cache pc
LEFT JOIN public.sku_stock_health sh ON sh.sku = pc.sku
LEFT JOIN public.brands b            ON b.id   = pc.brand_id
WHERE COALESCE(pc.discontinued, false) = false;

-- ── Part G: Update get_stock_health_summary to use quarantined from MV ─────────
-- Removes the expensive products_cache JOIN — quarantined is now in the MV.
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
  WITH scoped AS (
    SELECT health_category, on_hand_qty, quarantined
    FROM public.sku_stock_health
    WHERE (p_brand_id IS NULL OR brand_id = p_brand_id)
      AND (NOT p_exclude_dirt OR quarantined = false)
  ),
  cats AS (
    SELECT health_category, COUNT(*)::bigint AS n
    FROM scoped
    GROUP BY health_category
  )
  SELECT
    (SELECT COUNT(*)::bigint FROM scoped)                                       AS total_skus,
    (SELECT COUNT(*)::bigint FROM scoped WHERE quarantined)                     AS dirt_skus,
    COALESCE((SELECT SUM(on_hand_qty) FROM scoped), 0)::numeric                 AS total_on_hand,
    COALESCE(
      (SELECT jsonb_object_agg(COALESCE(health_category, 'Unknown'), n) FROM cats),
      '{}'::jsonb
    )                                                                            AS by_category;
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_health_summary(uuid, boolean) TO authenticated;
