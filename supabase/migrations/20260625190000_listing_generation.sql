-- ============================================================================
-- Opportunities O3 — listing generation. Per-store config (eBay business-policy
-- IDs + warehouse/location defaults) for the GTC import template, plus an RPC
-- that assembles each SKU's listing data (category, image, dims, brand, cost).
-- Price is computed client-side (Good band, via reprice.ts back-solve).
-- ============================================================================

-- Per-store config (one row per threeds_stores account).
CREATE TABLE IF NOT EXISTS public.ebay_listing_config (
  store_id           uuid PRIMARY KEY REFERENCES public.threeds_stores(id) ON DELETE CASCADE,
  policy_payment     text,
  policy_shipping    text,
  policy_return      text,
  location           text,
  postal_code        text,
  country_code       text NOT NULL DEFAULT 'GB',
  default_condition  text NOT NULL DEFAULT '1000',           -- 1000 = New
  measurement_system text NOT NULL DEFAULT 'METRIC',
  package_type       text NOT NULL DEFAULT 'PackageThickEnvelope',
  best_offer         boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ebay_listing_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read ebay_listing_config"  ON public.ebay_listing_config;
CREATE POLICY "auth read ebay_listing_config"  ON public.ebay_listing_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write ebay_listing_config" ON public.ebay_listing_config;
CREATE POLICY "auth write ebay_listing_config" ON public.ebay_listing_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Per-SKU listing data for the GTC template (price added client-side).
CREATE OR REPLACE FUNCTION public.get_listing_data_for_skus(p_skus text[])
RETURNS TABLE(
  sku text, title text, brand_name text, barcode text,
  cost_price numeric, stock numeric, ebay_category_id text,
  weight numeric, height numeric, length numeric, depth numeric, image_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    pc.sku, pc.name, b.name, pc.barcode,
    pc.cost_price, pc.current_stock, public.get_sku_ebay_category(pc.sku),
    pc.weight, pc.height, pc.length, pc.depth,
    (SELECT pi.public_url FROM product_images pi WHERE pi.product_id = pc.id
       ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1)
  FROM products_cache pc
  LEFT JOIN brands b ON b.id = pc.brand_id
  WHERE pc.sku = ANY(p_skus);
$$;
GRANT EXECUTE ON FUNCTION public.get_listing_data_for_skus(text[]) TO authenticated;
