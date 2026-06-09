-- products_cache.mintsoft_product_id had no index, so any query filtering on it
-- (e.g. the update-product-cost mirror) did a full seq scan of ~225k rows and hit
-- the statement timeout ("canceling statement due to statement timeout"). Add the
-- index so lookups/updates by that column are fast.
CREATE INDEX IF NOT EXISTS idx_products_cache_mintsoft_product_id
  ON public.products_cache (mintsoft_product_id);
