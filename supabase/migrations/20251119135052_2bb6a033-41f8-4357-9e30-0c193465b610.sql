-- Add Price Hunter fields to products_cache table
ALTER TABLE public.products_cache
ADD COLUMN ph_search_term TEXT,
ADD COLUMN ph_brand TEXT,
ADD COLUMN ph_last_checked_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN ph_plain_best_price NUMERIC,
ADD COLUMN ph_plain_best_seller TEXT,
ADD COLUMN ph_plain_best_item_id TEXT,
ADD COLUMN ph_brand_best_price NUMERIC,
ADD COLUMN ph_brand_best_seller TEXT,
ADD COLUMN ph_brand_best_item_id TEXT,
ADD COLUMN ph_status TEXT DEFAULT 'idle' CHECK (ph_status IN ('idle', 'queued', 'running', 'done', 'error')),
ADD COLUMN ph_error_message TEXT;

-- Create index for queued items (for n8n polling)
CREATE INDEX idx_products_cache_ph_status ON public.products_cache(ph_status) WHERE ph_status = 'queued';

-- Create index for filtering by brand and status
CREATE INDEX idx_products_cache_ph_brand_status ON public.products_cache(ph_brand, ph_status);