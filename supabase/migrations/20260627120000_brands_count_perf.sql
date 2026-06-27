-- PERF: /discovery/brands timed out (8s → 500 → page showed "0 brands").
-- get_brands_with_product_counts counts products per brand with a LATERAL
--   SELECT count(*) FROM products_cache WHERE sku LIKE b.prefix || '-%' (or '/%')
-- run once PER BRAND. On the DB's non-C collation a plain btree on sku can't serve
-- a `LIKE 'prefix%'`, so each brand seq-scanned all ~225k products (~100 brands ×
-- 225k = millions of scans). A text_pattern_ops index makes each brand an index
-- range-scan. Also speeds pick_stalest_brand_for_stock_sync (same LIKE, 15-min cron).

CREATE INDEX IF NOT EXISTS idx_products_cache_sku_pattern
  ON public.products_cache (sku text_pattern_ops);

-- Safety net only — with the index this should be sub-second.
ALTER FUNCTION public.get_brands_with_product_counts() SET statement_timeout = '15s';
