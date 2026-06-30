-- ============================================================================
-- 20260630400000_amazon_manual_map_check.sql
-- Diagnostic: list the manual ASIN->SKU mappings and whether the catalogue SKU
-- they point at actually carries a cost (mapping to a costless SKU doesn't fix
-- the POR distortion).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.amazon_manual_map_check()
RETURNS TABLE(asin text, catalogue_sku text, resolved_at timestamptz, cost_price numeric, has_cost boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, amazon
AS $$
  SELECT m.asin, m.catalogue_sku, m.resolved_at, pc.cost_price,
         (pc.cost_price IS NOT NULL AND pc.cost_price > 0) AS has_cost
  FROM amazon.asin_sku_map m
  LEFT JOIN public.products_cache pc ON pc.sku = m.catalogue_sku
  WHERE m.is_manual
  ORDER BY m.resolved_at DESC;
$$;
REVOKE ALL ON FUNCTION public.amazon_manual_map_check() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_manual_map_check() TO authenticated, service_role;
