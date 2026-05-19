
ALTER TABLE public.products_cache
  ADD COLUMN IF NOT EXISTS mintsoft_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_mintsoft_resolve_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS mintsoft_resolve_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mintsoft_resolve_ignored boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_cache_orphan_lookup
  ON public.products_cache (last_mintsoft_resolve_attempt_at NULLS FIRST)
  WHERE mintsoft_product_id IS NULL
    AND mintsoft_resolve_ignored = false
    AND quarantined = false
    AND discontinued = false;

CREATE OR REPLACE VIEW public.vw_orphan_skus AS
SELECT
  p.id,
  p.sku,
  p.name,
  p.brand_id,
  p.discovery_source,
  p.discovered_at,
  p.mintsoft_resolve_attempts,
  p.last_mintsoft_resolve_attempt_at,
  p.mintsoft_resolve_ignored,
  (p.sku ~ '^[A-Z0-9]{3}[-/]') AS is_true_sku
FROM public.products_cache p
WHERE p.mintsoft_product_id IS NULL
  AND p.quarantined = false
  AND p.discontinued = false;

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'orphan_sku_resolver.enabled',
  'true'::jsonb,
  'Master switch for the orphan SKU → Mintsoft Product ID resolver cron.'
)
ON CONFLICT (key) DO NOTHING;
