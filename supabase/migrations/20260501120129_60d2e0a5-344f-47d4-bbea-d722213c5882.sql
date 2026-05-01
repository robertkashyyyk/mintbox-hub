ALTER TABLE public.products_cache
  ADD COLUMN IF NOT EXISTS cost_price_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cost_price_source text;

COMMENT ON COLUMN public.products_cache.cost_price_source IS 'Source of last cost_price write: mintsoft_sync | csv_import | manual_ui';