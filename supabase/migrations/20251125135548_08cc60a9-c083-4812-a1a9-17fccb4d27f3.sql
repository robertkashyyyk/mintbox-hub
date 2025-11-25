-- Revoke all public access to the materialized view
REVOKE ALL ON sku_velocity FROM PUBLIC;
REVOKE ALL ON sku_velocity FROM anon;

-- Grant SELECT to authenticated users only
GRANT SELECT ON sku_velocity TO authenticated;

-- Add comment about access control
COMMENT ON MATERIALIZED VIEW sku_velocity IS 'Precomputed sales velocity metrics per SKU for 30/60/90 day windows. Access restricted to authenticated users only. Refresh periodically to keep data current.';