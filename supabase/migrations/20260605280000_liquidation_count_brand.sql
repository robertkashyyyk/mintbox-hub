-- Make the liquidation count brand-aware + return an accurate dead-count, so
-- the summary cards reflect ALL active filters (brand, velocity, capital),
-- not just the loaded top-N.
DROP FUNCTION IF EXISTS public.get_liquidation_candidate_count(numeric, numeric);
CREATE OR REPLACE FUNCTION public.get_liquidation_candidate_count(
  max_velocity numeric DEFAULT 0.5,
  min_capital  numeric DEFAULT 25,
  p_brand      text DEFAULT NULL
)
RETURNS TABLE(total bigint, total_capital numeric, dead_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    count(*)::bigint,
    round(COALESCE(sum(pc.current_stock * pc.cost_price), 0), 2),
    count(*) FILTER (
      WHERE NOT EXISTS (SELECT 1 FROM order_lines ol WHERE ol.sku = pc.sku)
    )::bigint
  FROM products_cache pc
  LEFT JOIN brands b ON b.id = pc.brand_id
  WHERE COALESCE(pc.discontinued, false) = false
    AND COALESCE(pc.quarantined, false) = false
    AND pc.current_stock > 0
    AND pc.cost_price > 0
    AND COALESCE(pc.velocity_per_week, 0) <= max_velocity
    AND (pc.current_stock * pc.cost_price) >= min_capital
    AND (p_brand IS NULL OR b.name = p_brand)
    AND NOT EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku = pc.sku AND c.status = 'active')
    AND NOT EXISTS (SELECT 1 FROM liquidation_exclusions x WHERE x.sku = pc.sku);
$$;
