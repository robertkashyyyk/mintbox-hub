
-- Create product_images table
CREATE TABLE public.product_images (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products_cache(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  public_url text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

-- RLS policies: authenticated can do everything, public can read
CREATE POLICY "Authenticated users can view product images"
  ON public.product_images FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert product images"
  ON public.product_images FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update product images"
  ON public.product_images FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete product images"
  ON public.product_images FOR DELETE
  TO authenticated
  USING (true);

-- Create the storage bucket (public for external URL usage)
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true);

-- Storage RLS: anyone can read (public bucket), authenticated can upload/delete
CREATE POLICY "Anyone can view product images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY "Authenticated users can upload product images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Authenticated users can delete product images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-images');
