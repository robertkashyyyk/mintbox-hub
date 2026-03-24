
CREATE TABLE public.pending_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggested_sku text NOT NULL,
  file_path text NOT NULL,
  public_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  promoted_product_id uuid REFERENCES public.products_cache(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

ALTER TABLE public.pending_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view pending images"
  ON public.pending_images FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert pending images"
  ON public.pending_images FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update pending images"
  ON public.pending_images FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete pending images"
  ON public.pending_images FOR DELETE TO authenticated
  USING (true);
