-- True total of liquidation candidates (the table only shows top-N by capital).
CREATE OR REPLACE FUNCTION public.get_liquidation_candidate_count(
  max_velocity numeric DEFAULT 0.5,
  min_capital  numeric DEFAULT 25
)
RETURNS TABLE(total bigint, total_capital numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT count(*)::bigint,
         round(COALESCE(sum(pc.current_stock * pc.cost_price), 0), 2)
  FROM products_cache pc
  WHERE COALESCE(pc.discontinued, false) = false
    AND COALESCE(pc.quarantined, false) = false
    AND pc.current_stock > 0
    AND pc.cost_price > 0
    AND COALESCE(pc.velocity_per_week, 0) <= max_velocity
    AND (pc.current_stock * pc.cost_price) >= min_capital
    AND NOT EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku = pc.sku AND c.status = 'active');
$$;
