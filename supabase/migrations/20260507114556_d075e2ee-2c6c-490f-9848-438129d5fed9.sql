DROP MATERIALIZED VIEW IF EXISTS public.sku_stock_health CASCADE;

CREATE MATERIALIZED VIEW public.sku_stock_health AS
WITH base AS (
  SELECT p.sku, p.brand_id,
    coalesce(v.avg_weekly_units, 0) as avg_weekly_units,
    coalesce(p.current_stock, 0) as on_hand_qty,
    b.base_multiplier
  FROM products_cache p
  LEFT JOIN sku_velocity v ON v.sku = p.sku
  LEFT JOIN brands b ON b.id = p.brand_id
),
calc AS (
  SELECT sku, brand_id, avg_weekly_units, on_hand_qty, base_multiplier,
    CASE WHEN avg_weekly_units = 0 THEN null
         ELSE (on_hand_qty::numeric / avg_weekly_units)
    END AS weeks_of_cover
  FROM base
)
SELECT sku, brand_id, avg_weekly_units, on_hand_qty, base_multiplier, weeks_of_cover,
  CASE
    WHEN on_hand_qty = 0 AND avg_weekly_units = 0 THEN 'Non Selling'
    WHEN on_hand_qty = 0 AND avg_weekly_units > 0 THEN 'Out of Stock'
    WHEN base_multiplier IS NULL THEN 'Missing Baseline'
    WHEN avg_weekly_units = 0 AND on_hand_qty > 0 THEN 'Dead Stock'
    WHEN weeks_of_cover IS NULL THEN 'Unknown'
    WHEN weeks_of_cover >= base_multiplier * 13 THEN 'Extreme Overstock'
    WHEN weeks_of_cover >= base_multiplier * 4 THEN 'Overstock'
    WHEN weeks_of_cover >= base_multiplier * 2 THEN 'Unhealthy'
    WHEN weeks_of_cover >= base_multiplier THEN 'Healthy'
    WHEN weeks_of_cover >= base_multiplier * 0.5 THEN 'Low Stock'
    WHEN weeks_of_cover > 0 THEN 'Critical'
    ELSE 'Unknown'
  END AS health_category
FROM calc;

CREATE UNIQUE INDEX idx_sku_stock_health_sku ON public.sku_stock_health (sku);
CREATE INDEX idx_sku_stock_health_brand ON public.sku_stock_health (brand_id);
CREATE INDEX idx_sku_stock_health_health ON public.sku_stock_health (health_category);

REFRESH MATERIALIZED VIEW public.sku_stock_health;

CREATE OR REPLACE VIEW public.buy_recommendations AS
SELECT sku, brand_id, avg_weekly_units, on_hand_qty, base_multiplier, weeks_of_cover,
  avg_weekly_units * (base_multiplier * 2::numeric) AS target_stock,
  avg_weekly_units * (base_multiplier * 2::numeric) - on_hand_qty AS recommended_purchase_qty
FROM public.sku_stock_health s
WHERE base_multiplier IS NOT NULL
  AND avg_weekly_units > 0::numeric
  AND (avg_weekly_units * (base_multiplier * 2::numeric) - on_hand_qty) > 0::numeric;