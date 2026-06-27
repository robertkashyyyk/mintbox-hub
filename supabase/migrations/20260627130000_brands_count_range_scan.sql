-- PERF (real fix): /discovery/brands.
-- The text_pattern_ops index (20260627120000) couldn't be used by the previous
-- definition because `sku LIKE (b.prefix || '-%')` has a NON-CONSTANT pattern —
-- Postgres only index-optimises LIKE when the prefix is known at plan time. So it
-- still seq-scanned ~225k products per brand (~11s).
--
-- Fix: replace the LIKE with an explicit prefix RANGE using the text_pattern_ops
-- comparison operators (~>=~ / ~<~). These ARE served by idx_products_cache_sku_pattern
-- even with per-brand bounds in the nested loop, so each brand becomes an index
-- range-scan. Results are BYTE-IDENTICAL to the old LIKE (same counts shown today —
-- including the existing overlapping-prefix behaviour), just fast.
--   prefix range for 'NGK-%'  = sku ~>=~ 'NGK-' AND sku ~<~ 'NGK.'  ('.' = byte after '-')
--   prefix range for 'NGK/%'  = sku ~>=~ 'NGK/' AND sku ~<~ 'NGK0'  ('0' = byte after '/')

CREATE OR REPLACE FUNCTION public.get_brands_with_product_counts()
 RETURNS TABLE(id uuid, name text, prefix text, prefix_style prefix_style, family text, remote_stock_feed_type remote_stock_feed_type, base_multiplier numeric, image_url_pattern text, image_search_domain text, created_at timestamp with time zone, auto_update_lsa boolean, last_lsa_auto_update_at timestamp with time zone, last_lsa_auto_update_summary jsonb, stock_sync_interval_hours integer, product_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '15s'
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
    WHERE p.sku ~>=~ (b.prefix || CASE WHEN b.prefix_style = 'slash' THEN '/' ELSE '-' END)
      AND p.sku ~<~  (b.prefix || CASE WHEN b.prefix_style = 'slash' THEN '0' ELSE '.' END)
  ) c ON true
  ORDER BY b.name;
$function$;
