-- Create materialized view for SKU velocity analytics
CREATE MATERIALIZED VIEW sku_velocity AS
SELECT
    sku,
    brand_id,
    SUM(CASE WHEN order_date >= NOW() - INTERVAL '30 days' THEN qty ELSE 0 END) AS units_30d,
    SUM(CASE WHEN order_date >= NOW() - INTERVAL '60 days' THEN qty ELSE 0 END) AS units_60d,
    SUM(CASE WHEN order_date >= NOW() - INTERVAL '90 days' THEN qty ELSE 0 END) AS units_90d,
    (SUM(CASE WHEN order_date >= NOW() - INTERVAL '90 days' THEN qty ELSE 0 END) / 12.0) AS avg_weekly_units
FROM order_lines
GROUP BY sku, brand_id;

-- Create indexes for performance
CREATE INDEX idx_sku_velocity_sku ON sku_velocity (sku);
CREATE INDEX idx_sku_velocity_brand ON sku_velocity (brand_id);

-- Enable RLS on the materialized view
ALTER MATERIALIZED VIEW sku_velocity OWNER TO postgres;

-- Add a comment for documentation
COMMENT ON MATERIALIZED VIEW sku_velocity IS 'Precomputed sales velocity metrics per SKU for 30/60/90 day windows. Refresh periodically to keep data current.';