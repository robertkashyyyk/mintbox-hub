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
  WITH scoped AS (
    SELECT
      h.health_category,
      COALESCE(h.on_hand_qty, 0) AS on_hand_qty,
      COALESCE(p.quarantined, false) AS is_dirt
    FROM public.sku_stock_health h
    LEFT JOIN public.products_cache p ON p.sku = h.sku
    WHERE (p_brand_id IS NULL OR h.brand_id = p_brand_id)
      AND (NOT p_exclude_dirt OR COALESCE(p.quarantined, false) = false)
  ),
  cats AS (
    SELECT health_category, COUNT(*)::bigint AS n
    FROM scoped
    GROUP BY health_category
  )
  SELECT
    (SELECT COUNT(*)::bigint FROM scoped) AS total_skus,
    (SELECT COUNT(*) FILTER (WHERE is_dirt)::bigint FROM scoped) AS dirt_skus,
    (SELECT COALESCE(SUM(on_hand_qty), 0)::numeric FROM scoped) AS total_on_hand,
    COALESCE(
      (SELECT jsonb_object_agg(COALESCE(health_category, 'Unknown'), n) FROM cats),
      '{}'::jsonb
    ) AS by_category;
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_health_summary(uuid, boolean) TO authenticated;