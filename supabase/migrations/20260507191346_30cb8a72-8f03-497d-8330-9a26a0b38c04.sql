-- 1. Audit table for candidate status / review activity
CREATE TABLE IF NOT EXISTS public.image_scout_candidate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.image_scout_candidates(id) ON DELETE CASCADE,
  old_status public.image_scout_candidate_status,
  new_status public.image_scout_candidate_status,
  action text NOT NULL,
  notes text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iscand_events_candidate
  ON public.image_scout_candidate_events (candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iscand_events_user
  ON public.image_scout_candidate_events (user_id, created_at DESC);

ALTER TABLE public.image_scout_candidate_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read iscand_events" ON public.image_scout_candidate_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert iscand_events" ON public.image_scout_candidate_events
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "service all iscand_events" ON public.image_scout_candidate_events
  TO service_role USING (true) WITH CHECK (true);

-- 2. Trigger that writes an audit row whenever status changes
CREATE OR REPLACE FUNCTION public.log_image_scout_candidate_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.image_scout_candidate_events
      (candidate_id, old_status, new_status, action, notes, user_id)
    VALUES
      (NEW.id, OLD.status, NEW.status, 'status_change', NEW.review_notes, NEW.reviewed_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_iscand_status ON public.image_scout_candidates;
CREATE TRIGGER trg_log_iscand_status
AFTER UPDATE ON public.image_scout_candidates
FOR EACH ROW
EXECUTE FUNCTION public.log_image_scout_candidate_status_change();

-- 3. Duplicate-image lookup view: which image_urls are used by multiple SKUs
CREATE OR REPLACE VIEW public.image_scout_duplicate_images AS
SELECT
  image_url,
  COUNT(DISTINCT sku) AS sku_count,
  COUNT(*) AS candidate_count,
  array_agg(DISTINCT sku ORDER BY sku) AS skus
FROM public.image_scout_candidates
GROUP BY image_url
HAVING COUNT(DISTINCT sku) > 1;