
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS stock_sync_interval_hours integer NOT NULL DEFAULT 24;

ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_stock_sync_interval_hours_positive;

ALTER TABLE public.brands
  ADD CONSTRAINT brands_stock_sync_interval_hours_positive
  CHECK (stock_sync_interval_hours >= 1 AND stock_sync_interval_hours <= 168);

DROP FUNCTION IF EXISTS public.get_brands_with_product_counts();

CREATE FUNCTION public.get_brands_with_product_counts()
 RETURNS TABLE(id uuid, name text, prefix text, prefix_style prefix_style, family text, remote_stock_feed_type remote_stock_feed_type, base_multiplier numeric, image_url_pattern text, image_search_domain text, created_at timestamp with time zone, auto_update_lsa boolean, last_lsa_auto_update_at timestamp with time zone, last_lsa_auto_update_summary jsonb, stock_sync_interval_hours integer, product_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    b.id, b.name, b.prefix, b.prefix_style, b.family,
    b.remote_stock_feed_type, b.base_multiplier,
    b.image_url_pattern, b.image_search_domain, b.created_at,
    b.auto_update_lsa, b.last_lsa_auto_update_at, b.last_lsa_auto_update_summary,
    b.stock_sync_interval_hours,
    COALESCE(c.cnt, 0)::bigint AS product_count
  FROM public.brands b
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt
    FROM public.products_cache p
    WHERE p.sku LIKE b.prefix ||
      CASE WHEN b.prefix_style = 'slash' THEN '/%' ELSE '-%' END
  ) c ON true
  ORDER BY b.name;
$function$;

CREATE OR REPLACE FUNCTION public.pick_stalest_brand_for_stock_sync()
 RETURNS TABLE(id uuid, name text, oldest_sync timestamp with time zone, sku_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH brand_skus AS (
    SELECT
      b.id,
      b.name,
      b.stock_sync_interval_hours,
      MIN(p.last_stock_sync) AS oldest_sync,
      COUNT(*)::bigint AS sku_count
    FROM brands b
    JOIN products_cache p
      ON p.mintsoft_product_id IS NOT NULL
     AND (
       (b.prefix_style = 'slash'  AND p.sku LIKE b.prefix || '/%') OR
       (b.prefix_style <> 'slash' AND p.sku LIKE b.prefix || '-%')
     )
    GROUP BY b.id, b.name, b.stock_sync_interval_hours
  )
  SELECT id, name, oldest_sync, sku_count
  FROM brand_skus
  WHERE oldest_sync IS NULL
     OR oldest_sync < (now() - make_interval(hours => stock_sync_interval_hours))
  ORDER BY oldest_sync ASC NULLS FIRST, sku_count ASC
  LIMIT 1;
$function$;
