DO $$ BEGIN
  CREATE TYPE public.image_scout_candidate_status AS ENUM ('new','shortlisted','dismissed','manual_required','approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.image_scout_candidates
  ADD COLUMN IF NOT EXISTS status public.image_scout_candidate_status NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text;

CREATE INDEX IF NOT EXISTS idx_image_scout_candidates_status
  ON public.image_scout_candidates (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_scout_candidates_brand
  ON public.image_scout_candidates (brand_id);