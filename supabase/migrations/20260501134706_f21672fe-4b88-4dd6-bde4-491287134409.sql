
CREATE OR REPLACE FUNCTION public.pick_stalest_brand_for_stock_sync()
RETURNS TABLE(id uuid, name text, oldest_sync timestamptz, sku_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH brand_skus AS (
    SELECT
      b.id,
      b.name,
      MIN(p.last_stock_sync) AS oldest_sync,
      COUNT(*)::bigint AS sku_count
    FROM brands b
    JOIN products_cache p
      ON p.mintsoft_product_id IS NOT NULL
     AND (
       (b.prefix_style = 'slash'  AND p.sku LIKE b.prefix || '/%') OR
       (b.prefix_style <> 'slash' AND p.sku LIKE b.prefix || '-%')
     )
    GROUP BY b.id, b.name
  )
  SELECT id, name, oldest_sync, sku_count
  FROM brand_skus
  ORDER BY oldest_sync ASC NULLS FIRST, sku_count ASC
  LIMIT 1;
$$;
