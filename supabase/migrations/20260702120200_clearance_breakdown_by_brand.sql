-- Brand-scope the Clearance metric cards. get_clearance_breakdown gains an
-- optional p_brand: when set, the on-sale / in-liquidation capital + counts are
-- restricted to that brand's SKUs (join price_campaigns → products_cache → brands).
-- p_brand NULL keeps the existing all-brands behaviour, so the no-arg call site
-- still works. Single function (drop the no-arg overload to avoid PostgREST
-- ambiguity).
DROP FUNCTION IF EXISTS public.get_clearance_breakdown();
DROP FUNCTION IF EXISTS public.get_clearance_breakdown(text);
CREATE OR REPLACE FUNCTION public.get_clearance_breakdown(p_brand text DEFAULT NULL)
RETURNS TABLE(
  on_sale_count       bigint,
  on_sale_capital     numeric,
  liquidation_count   bigint,
  liquidation_capital numeric,
  campaigns_run       bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    count(*) FILTER (WHERE pcmp.status = 'active' AND pcmp.type = 'sale')::bigint,
    round(COALESCE(sum(pcmp.baseline_stock * pcmp.baseline_cost) FILTER (WHERE pcmp.status = 'active' AND pcmp.type = 'sale'), 0), 2),
    count(*) FILTER (WHERE pcmp.status = 'active' AND pcmp.type = 'liquidation')::bigint,
    round(COALESCE(sum(pcmp.baseline_stock * pcmp.baseline_cost) FILTER (WHERE pcmp.status = 'active' AND pcmp.type = 'liquidation'), 0), 2),
    count(*) FILTER (WHERE pcmp.status IN ('ended', 'reverted'))::bigint
  FROM price_campaigns pcmp
  LEFT JOIN products_cache pc ON pc.sku = pcmp.sku
  LEFT JOIN brands b ON b.id = pc.brand_id
  WHERE p_brand IS NULL OR COALESCE(b.name, '(no brand)') = p_brand;
$$;
GRANT EXECUTE ON FUNCTION public.get_clearance_breakdown(text) TO authenticated;
