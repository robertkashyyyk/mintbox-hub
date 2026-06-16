-- Fix the mintsoft-enrich-batch timeout. The batch picks the next products to enrich with:
--   WHERE mintsoft_product_id IS NOT NULL AND (last_stock_sync IS NULL OR last_stock_sync < stale)
--   ORDER BY last_stock_sync ASC NULLS FIRST LIMIT 500
-- There was no index on last_stock_sync, so it Parallel-Seq-Scanned + top-N-sorted ~225k rows
-- (~4s for LIMIT 100, well over the 8s statement timeout at LIMIT 500) → the batch has been
-- erroring "Failed to fetch products: statement timeout" since ~5 Jun, so nothing gets enriched.
--
-- Partial index ordered by last_stock_sync NULLS FIRST over the enrichable set turns it into an
-- index scan that stops at LIMIT — milliseconds.
CREATE INDEX IF NOT EXISTS idx_products_cache_enrich_queue
  ON public.products_cache (last_stock_sync ASC NULLS FIRST)
  WHERE mintsoft_product_id IS NOT NULL;
