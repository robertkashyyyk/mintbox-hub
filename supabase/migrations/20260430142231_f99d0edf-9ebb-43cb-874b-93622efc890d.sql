
ALTER TABLE public.products_cache
ADD COLUMN IF NOT EXISTS mintsoft_categories text[] DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_products_cache_mintsoft_categories
  ON public.products_cache USING GIN (mintsoft_categories);
