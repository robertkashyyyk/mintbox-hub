-- Missing Costs Game — treat zero-cost products as "missing", not just NULL.
--
-- The Mintsoft sync writes cost_price = 0 (not NULL) for products with no cost set
-- (CostPrice ?? null evaluates to 0 when Mintsoft returns 0). The game's Top Sellers
-- mode RPC filtered `cost_price IS NULL`, so it matched almost nothing. This brings it
-- in line with order_line_economics.missing_cost (cost_each IS NULL OR cost_each = 0).
CREATE OR REPLACE FUNCTION public.get_top_missing_cost_skus(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, sku text, name text, brand_id uuid, brand_name text, mintsoft_product_id bigint, units_28d numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH agg AS (
    SELECT ole.sku, SUM(ole.qty)::numeric AS units
    FROM public.order_line_economics ole
    WHERE ole.missing_cost = true
      AND ole.order_date >= now() - interval '28 days'
    GROUP BY ole.sku
  )
  SELECT pc.id, pc.sku, pc.name, pc.brand_id, b.name AS brand_name,
         pc.mintsoft_product_id, a.units AS units_28d
  FROM agg a
  JOIN public.products_cache pc ON pc.sku = a.sku
  LEFT JOIN public.brands b ON b.id = pc.brand_id
  WHERE (pc.cost_price IS NULL OR pc.cost_price <= 0)
    AND COALESCE(pc.discontinued, false) = false
    AND COALESCE(pc.quarantined, false) = false
    AND pc.mintsoft_product_id IS NOT NULL
  ORDER BY a.units DESC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_top_missing_cost_skus(integer) TO authenticated;
