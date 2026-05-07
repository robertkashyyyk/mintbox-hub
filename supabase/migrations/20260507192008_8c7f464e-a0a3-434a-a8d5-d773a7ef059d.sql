-- Status enum
DO $$ BEGIN
  CREATE TYPE public.approved_image_status AS ENUM ('pending','processing','completed','failed','manual_required');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.approved_product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.image_scout_candidates(id) ON DELETE CASCADE,
  sku text NOT NULL,
  brand text,
  part_number text,
  source_image_url text,
  original_storage_path text,
  processed_storage_path text,
  width int,
  height int,
  processing_status public.approved_image_status NOT NULL DEFAULT 'pending',
  processing_provider text NOT NULL DEFAULT 'basic_normalize',
  processing_version text NOT NULL DEFAULT '1.0.0',
  processing_error text,
  safety_flags text[] NOT NULL DEFAULT '{}',
  approved_by uuid,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_api_sku ON public.approved_product_images(sku);
CREATE INDEX IF NOT EXISTS idx_api_status ON public.approved_product_images(processing_status);

ALTER TABLE public.approved_product_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read approved images" ON public.approved_product_images;
CREATE POLICY "auth read approved images" ON public.approved_product_images
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth write approved images" ON public.approved_product_images;
CREATE POLICY "auth write approved images" ON public.approved_product_images
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_approved_images_updated_at
  BEFORE UPDATE ON public.approved_product_images
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Auto-create pending pipeline row when a candidate is approved
CREATE OR REPLACE FUNCTION public.queue_approved_image_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved') THEN
    INSERT INTO public.approved_product_images
      (candidate_id, sku, source_image_url, width, height, approved_by, approved_at)
    VALUES
      (NEW.id, NEW.sku, NEW.image_url, NEW.image_width, NEW.image_height, NEW.reviewed_by, now())
    ON CONFLICT (candidate_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_iscand_queue_pipeline ON public.image_scout_candidates;
CREATE TRIGGER trg_iscand_queue_pipeline
  AFTER UPDATE ON public.image_scout_candidates
  FOR EACH ROW EXECUTE FUNCTION public.queue_approved_image_pipeline();

-- Storage buckets
INSERT INTO storage.buckets (id, name, public)
  VALUES ('image-scout-originals', 'image-scout-originals', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('image-scout-processed', 'image-scout-processed', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "iscoutorig auth read" ON storage.objects;
CREATE POLICY "iscoutorig auth read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'image-scout-originals');

DROP POLICY IF EXISTS "iscoutorig auth write" ON storage.objects;
CREATE POLICY "iscoutorig auth write" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'image-scout-originals')
  WITH CHECK (bucket_id = 'image-scout-originals');

DROP POLICY IF EXISTS "iscoutproc public read" ON storage.objects;
CREATE POLICY "iscoutproc public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'image-scout-processed');

DROP POLICY IF EXISTS "iscoutproc auth write" ON storage.objects;
CREATE POLICY "iscoutproc auth write" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'image-scout-processed')
  WITH CHECK (bucket_id = 'image-scout-processed');