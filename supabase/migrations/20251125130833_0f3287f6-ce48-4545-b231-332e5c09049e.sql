-- Add discovery tracking fields to products_cache
ALTER TABLE public.products_cache
ADD COLUMN IF NOT EXISTS discovery_source text,
ADD COLUMN IF NOT EXISTS discovered_at timestamptz DEFAULT now();

-- Create view for products needing enrichment (discovered from orders but missing key data)
CREATE OR REPLACE VIEW public.products_needs_enrichment AS
SELECT *
FROM public.products_cache
WHERE discovery_source = 'order'
  AND (cost_price IS NULL OR current_stock IS NULL);

-- Grant access to the view
GRANT SELECT ON public.products_needs_enrichment TO authenticated;