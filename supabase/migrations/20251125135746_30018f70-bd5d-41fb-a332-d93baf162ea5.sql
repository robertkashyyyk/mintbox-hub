-- Create materialized view for SKU stock health analytics
CREATE MATERIALIZED VIEW sku_stock_health AS
WITH base AS (
  SELECT
    p.sku,
    v.brand_id,  -- Get brand_id from sku_velocity (already resolved from order_lines)
    COALESCE(v.avg_weekly_units, 0) AS avg_weekly_units,
    COALESCE(p.current_stock, 0)    AS on_hand_qty,
    b.base_multiplier
  FROM products_cache p
  LEFT JOIN sku_velocity v ON v.sku = p.sku
  LEFT JOIN brands b       ON b.id = v.brand_id
),
calc AS (
  SELECT
    sku,
    brand_id,
    avg_weekly_units,
    on_hand_qty,
    base_multiplier,
    CASE
      WHEN avg_weekly_units = 0 THEN NULL
      ELSE (on_hand_qty::numeric / avg_weekly_units)
    END AS weeks_of_cover
  FROM base
)
SELECT
  sku,
  brand_id,
  avg_weekly_units,
  on_hand_qty,
  base_multiplier,
  weeks_of_cover,
  CASE
    WHEN base_multiplier IS NULL THEN 'Missing Baseline'
    WHEN on_hand_qty = 0 AND avg_weekly_units = 0 THEN 'Out of Stock'
    WHEN avg_weekly_units = 0 AND on_hand_qty > 0 THEN 'Dead Stock'
    WHEN weeks_of_cover IS NULL THEN 'Unknown'
    WHEN weeks_of_cover >= base_multiplier * 13 THEN 'Extreme Overstock'
    WHEN weeks_of_cover >= base_multiplier * 4  THEN 'Overstock'
    WHEN weeks_of_cover >= base_multiplier * 2  THEN 'Unhealthy'
    WHEN weeks_of_cover >= base_multiplier      THEN 'Healthy'
    WHEN weeks_of_cover >= base_multiplier * 0.5 THEN 'Low Stock'
    WHEN weeks_of_cover > 0                     THEN 'Critical'
    ELSE 'Unknown'
  END AS health_category
FROM calc;

-- Create indexes for performance
CREATE INDEX idx_sku_stock_health_sku ON sku_stock_health (sku);
CREATE INDEX idx_sku_stock_health_brand ON sku_stock_health (brand_id);
CREATE INDEX idx_sku_stock_health_health ON sku_stock_health (health_category);

-- Set ownership
ALTER MATERIALIZED VIEW sku_stock_health OWNER TO postgres;

-- Secure the materialized view - restrict to authenticated users
REVOKE ALL ON sku_stock_health FROM PUBLIC;
REVOKE ALL ON sku_stock_health FROM anon;
GRANT SELECT ON sku_stock_health TO authenticated;

-- Add documentation
COMMENT ON MATERIALIZED VIEW sku_stock_health IS 'Stock health classification combining velocity, inventory levels, and brand multipliers. Categories: Missing Baseline, Out of Stock, Dead Stock, Unknown, Extreme Overstock, Overstock, Unhealthy, Healthy, Low Stock, Critical. Access restricted to authenticated users. Refresh after updating sku_velocity or products_cache.';