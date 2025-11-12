-- Add mintsoft_product_id column to products_cache
ALTER TABLE public.products_cache 
ADD COLUMN IF NOT EXISTS mintsoft_product_id INTEGER;