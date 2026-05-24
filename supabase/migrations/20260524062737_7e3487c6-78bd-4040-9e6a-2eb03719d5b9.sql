-- Stock Valuation: view + summary RPC
CREATE OR REPLACE VIEW public.stock_valuation
WITH (security_invoker = true) AS
SELECT
  pc.sku,
  pc.brand_id,
  b.name AS brand_name,
  COALESCE(pc.current_stock, 0)::numeric AS current_stock,
  pc.cost_price,
  (COALESCE(pc.cost_price, 0) * COALESCE(pc.current_stock, 0))::numeric AS net_value,
  COALESCE(sh.health_category, 'Unknown') AS health_category,
  pc.quarantined
FROM public.products_cache pc
LEFT JOIN public.sku_stock_health sh ON sh.sku = pc.sku
LEFT JOIN public.brands b ON b.id = pc.brand_id
WHERE COALESCE(pc.discontinued, false) = false;

CREATE OR REPLACE FUNCTION public.get_stock_valuation_summary(
  p_brand_id uuid DEFAULT NULL,
  p_exclude_dirt boolean DEFAULT false
) RETURNS TABLE(
  total_skus bigint,
  total_units numeric,
  total_value numeric,
  missing_cost_skus bigint,
  missing_cost_units numeric,
  by_category jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT * FROM public.stock_valuation
    WHERE (p_brand_id IS NULL OR brand_id = p_brand_id)
      AND (NOT p_exclude_dirt OR quarantined = false)
  ),
  cats AS (
    SELECT health_category AS cat,
      count(*)::bigint AS skus,
      COALESCE(SUM(current_stock), 0) AS units,
      COALESCE(SUM(net_value), 0) AS value
    FROM base GROUP BY 1
  )
  SELECT
    (SELECT count(*) FROM base)::bigint,
    COALESCE((SELECT SUM(current_stock) FROM base), 0),
    COALESCE((SELECT SUM(net_value) FROM base), 0),
    (SELECT count(*) FROM base WHERE (cost_price IS NULL OR cost_price = 0) AND current_stock > 0)::bigint,
    COALESCE((SELECT SUM(current_stock) FROM base WHERE (cost_price IS NULL OR cost_price = 0) AND current_stock > 0), 0),
    COALESCE(
      (SELECT jsonb_object_agg(cat, jsonb_build_object('skus', skus, 'units', units, 'value', value)) FROM cats),
      '{}'::jsonb
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_valuation_summary(uuid, boolean) TO authenticated;
GRANT SELECT ON public.stock_valuation TO authenticated;