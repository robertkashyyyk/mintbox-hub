-- ============================================================================
-- Opportunities → listing creation: internal-category → eBay-CategoryID map.
-- A SKU's eBay category (the hardest GTC template field) is resolved from its
-- internal product category via this hand-curated map (managed in Admin).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ebay_category_map (
  internal_category  text PRIMARY KEY,       -- product_categories.name
  ebay_category_id   text NOT NULL,          -- eBay CategoryID (number, as text)
  ebay_category_name text,                   -- human description
  updated_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ebay_category_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read ebay_category_map"  ON public.ebay_category_map;
CREATE POLICY "auth read ebay_category_map"  ON public.ebay_category_map FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write ebay_category_map" ON public.ebay_category_map;
CREATE POLICY "auth write ebay_category_map" ON public.ebay_category_map FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Resolve a SKU's eBay CategoryID via its internal category (first match).
CREATE OR REPLACE FUNCTION public.get_sku_ebay_category(p_sku text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT m.ebay_category_id
  FROM products_cache pc
  JOIN product_category_links pcl ON pcl.product_id = pc.id
  JOIN product_categories cat ON cat.id = pcl.category_id
  JOIN ebay_category_map m ON m.internal_category = cat.name
  WHERE pc.sku = p_sku
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_sku_ebay_category(text) TO authenticated;

-- Internal categories that have in-stock, UNLISTED SKUs but no eBay mapping yet —
-- so Admin knows exactly what to map (ranked by how many SKUs it would unlock).
CREATE OR REPLACE FUNCTION public.get_unmapped_ebay_categories()
RETURNS TABLE(internal_category text, sku_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT cat.name, count(DISTINCT pc.sku)
  FROM products_cache pc
  JOIN product_category_links pcl ON pcl.product_id = pc.id
  JOIN product_categories cat ON cat.id = pcl.category_id
  WHERE COALESCE(pc.discontinued, false) = false
    AND COALESCE(pc.quarantined, false) = false
    AND pc.current_stock > 0
    AND NOT EXISTS (SELECT 1 FROM ebay_category_map m WHERE m.internal_category = cat.name)
    AND NOT EXISTS (SELECT 1 FROM listing_coverage lc WHERE lc.sku = pc.sku AND lc.channel = 'ebay' AND lc.status = 'Active')
  GROUP BY cat.name
  ORDER BY count(DISTINCT pc.sku) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_unmapped_ebay_categories() TO authenticated;
