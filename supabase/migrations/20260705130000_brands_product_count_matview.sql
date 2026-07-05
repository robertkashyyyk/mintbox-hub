-- Brands page (/discovery/brands) took ~25s. get_brands_with_product_counts() counted
-- products per brand with `sku LIKE b.prefix || '-%'` in a LEFT JOIN LATERAL — once per brand,
-- 79 * 225k = 9.7M buffer hits. The concatenated LIKE pattern can't use an index, and even a
-- single grouped pass still scans the whole ~1GB products_cache heap for `sku` (~13s).
--
-- The product_count is display-only and fine slightly stale, so materialize the prefix counts
-- and refresh nightly; the RPC then reads a few hundred matview rows (~60ms).

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_brand_prefix_counts AS
  SELECT upper(CASE
           WHEN strpos(sku,'-') > 0 AND (strpos(sku,'/') = 0 OR strpos(sku,'-') < strpos(sku,'/'))
             THEN split_part(sku,'-',1)
           WHEN strpos(sku,'/') > 0 THEN split_part(sku,'/',1)
           ELSE sku
         END) AS pfx,
         count(*)::bigint AS cnt
  FROM public.products_cache
  GROUP BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_brand_prefix_counts_pfx ON public.mv_brand_prefix_counts(pfx);
GRANT SELECT ON public.mv_brand_prefix_counts TO authenticated, service_role;

-- Prefix match mirrors the old LIKE semantics (leading run before the first '-' or '/').
CREATE OR REPLACE FUNCTION public.get_brands_with_product_counts()
RETURNS TABLE(id uuid, name text, prefix text, prefix_style prefix_style, family text,
              remote_stock_feed_type remote_stock_feed_type, base_multiplier numeric,
              image_url_pattern text, image_search_domain text, created_at timestamptz,
              auto_update_lsa boolean, last_lsa_auto_update_at timestamptz,
              last_lsa_auto_update_summary jsonb, stock_sync_interval_hours integer,
              product_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT b.id, b.name, b.prefix, b.prefix_style, b.family,
         b.remote_stock_feed_type, b.base_multiplier,
         b.image_url_pattern, b.image_search_domain, b.created_at,
         b.auto_update_lsa, b.last_lsa_auto_update_at, b.last_lsa_auto_update_summary,
         b.stock_sync_interval_hours,
         COALESCE(m.cnt, 0)::bigint AS product_count
  FROM public.brands b
  LEFT JOIN public.mv_brand_prefix_counts m ON m.pfx = upper(b.prefix)
  ORDER BY b.name;
$function$;

-- Nightly refresh (concurrent → no read lock). cron.schedule upserts by job name.
SELECT cron.schedule('refresh-brand-prefix-counts', '30 3 * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brand_prefix_counts');
