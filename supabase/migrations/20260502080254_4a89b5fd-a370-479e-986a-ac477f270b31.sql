UPDATE public.products_cache
SET brand_id = '9d2e60b1-90bd-4131-9d6a-dfcdd3eb132e'
WHERE brand_id IS NULL
  AND sku LIKE 'MAY-%';

REFRESH MATERIALIZED VIEW public.sku_stock_health;