-- ============================================================================
-- Opportunities — per-SKU listing editor (drawer) + listing queue.
-- listing_drafts: human edits to a SKU's listing fields (title, description,
--   category, mpn, size, condition, price) — the generator prefers these over
--   raw catalogue data.
-- listing_queue: "Push to list" writes here; O3b drains pending → SFTP GTC file.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.listing_drafts (
  sku                text PRIMARY KEY,
  title              text,
  description        text,
  ebay_category_id   text,
  ebay_category_name text,
  mpn                text,
  size               text,
  condition          text,
  price              numeric,
  notes              text,
  updated_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.listing_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read listing_drafts"  ON public.listing_drafts;
CREATE POLICY "auth read listing_drafts"  ON public.listing_drafts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write listing_drafts" ON public.listing_drafts;
CREATE POLICY "auth write listing_drafts" ON public.listing_drafts FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.listing_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku          text NOT NULL,
  store_id     uuid NOT NULL REFERENCES public.threeds_stores(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending',   -- pending | generated | listed | failed
  queued_by    uuid,
  queued_at    timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_queue_pending ON public.listing_queue(sku, store_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_listing_queue_status ON public.listing_queue(status);
ALTER TABLE public.listing_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read listing_queue"  ON public.listing_queue;
CREATE POLICY "auth read listing_queue"  ON public.listing_queue FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write listing_queue" ON public.listing_queue;
CREATE POLICY "auth write listing_queue" ON public.listing_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Merged per-SKU listing detail for the drawer (draft over catalogue).
CREATE OR REPLACE FUNCTION public.get_listing_detail(p_sku text)
RETURNS TABLE(
  sku text, product_id uuid, title text, description text, brand_name text, barcode text,
  cost_price numeric, stock numeric, ebay_category_id text, ebay_category_name text,
  mpn text, size text, condition text, price numeric,
  weight numeric, height numeric, length numeric, depth numeric, image_url text,
  has_category boolean, has_image boolean, has_dims boolean, has_barcode boolean, has_brand boolean,
  queued_pending integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    pc.sku, pc.id,
    COALESCE(d.title, pc.name),
    d.description,
    b.name, pc.barcode, pc.cost_price, pc.current_stock,
    COALESCE(d.ebay_category_id, public.get_sku_ebay_category(pc.sku)),
    d.ebay_category_name,
    d.mpn, d.size, COALESCE(d.condition, '1000'), d.price,
    pc.weight, pc.height, pc.length, pc.depth,
    (SELECT pi.public_url FROM product_images pi WHERE pi.product_id = pc.id ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1),
    (COALESCE(d.ebay_category_id, public.get_sku_ebay_category(pc.sku)) IS NOT NULL),
    EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = pc.id),
    (COALESCE(pc.weight,0)>0 AND COALESCE(pc.height,0)>0 AND COALESCE(pc.length,0)>0 AND COALESCE(pc.depth,0)>0),
    (pc.barcode IS NOT NULL AND length(btrim(pc.barcode))>0),
    (pc.brand_id IS NOT NULL),
    (SELECT count(*)::int FROM listing_queue q WHERE q.sku = pc.sku AND q.status = 'pending')
  FROM products_cache pc
  LEFT JOIN brands b ON b.id = pc.brand_id
  LEFT JOIN listing_drafts d ON d.sku = pc.sku
  WHERE pc.sku = p_sku;
$$;
GRANT EXECUTE ON FUNCTION public.get_listing_detail(text) TO authenticated;

-- Generator now prefers drafts (title/description/category/mpn/size/condition/price).
DROP FUNCTION IF EXISTS public.get_listing_data_for_skus(text[]);
CREATE OR REPLACE FUNCTION public.get_listing_data_for_skus(p_skus text[])
RETURNS TABLE(
  sku text, title text, description text, brand_name text, barcode text,
  cost_price numeric, stock numeric, ebay_category_id text,
  mpn text, size text, condition text, price numeric,
  weight numeric, height numeric, length numeric, depth numeric, image_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    pc.sku,
    COALESCE(d.title, pc.name),
    d.description,
    b.name, pc.barcode, pc.cost_price, pc.current_stock,
    COALESCE(d.ebay_category_id, public.get_sku_ebay_category(pc.sku)),
    d.mpn, d.size, COALESCE(d.condition, '1000'), d.price,
    pc.weight, pc.height, pc.length, pc.depth,
    (SELECT pi.public_url FROM product_images pi WHERE pi.product_id = pc.id ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1)
  FROM products_cache pc
  LEFT JOIN brands b ON b.id = pc.brand_id
  LEFT JOIN listing_drafts d ON d.sku = pc.sku
  WHERE pc.sku = ANY(p_skus);
$$;
GRANT EXECUTE ON FUNCTION public.get_listing_data_for_skus(text[]) TO authenticated;
