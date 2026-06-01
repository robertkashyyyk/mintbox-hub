-- Rewrite get_stock_health_summary to eliminate the expensive products_cache JOIN
-- that caused statement timeouts. Quarantined SKU lookup is now a small CTE
-- (only ~200 rows) joined into the already-indexed sku_stock_health MV.

CREATE OR REPLACE FUNCTION public.get_stock_health_summary(
  p_brand_id uuid DEFAULT NULL,
  p_exclude_dirt boolean DEFAULT false
)
RETURNS TABLE (
  total_skus bigint,
  dirt_skus bigint,
  total_on_hand numeric,
  by_category jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  dirt AS (
    SELECT sku FROM public.products_cache WHERE quarantined = true
  ),
  scoped AS (
    SELECT
      h.health_category,
      h.on_hand_qty,
      (d.sku IS NOT NULL) AS is_dirt
    FROM public.sku_stock_health h
    LEFT JOIN dirt d ON d.sku = h.sku
    WHERE (p_brand_id IS NULL OR h.brand_id = p_brand_id)
      AND (NOT p_exclude_dirt OR d.sku IS NULL)
  ),
  cats AS (
    SELECT health_category, COUNT(*)::bigint AS n
    FROM scoped
    GROUP BY health_category
  )
  SELECT
    (SELECT COUNT(*)::bigint FROM scoped)                                       AS total_skus,
    (SELECT COUNT(*)::bigint  FROM scoped WHERE is_dirt)                        AS dirt_skus,
    COALESCE((SELECT SUM(on_hand_qty) FROM scoped), 0)::numeric                 AS total_on_hand,
    COALESCE(
      (SELECT jsonb_object_agg(COALESCE(health_category, 'Unknown'), n) FROM cats),
      '{}'::jsonb
    )                                                                            AS by_category;
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_health_summary(uuid, boolean) TO authenticated;
