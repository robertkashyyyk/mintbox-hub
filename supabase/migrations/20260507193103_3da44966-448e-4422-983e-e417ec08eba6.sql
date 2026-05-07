CREATE TABLE IF NOT EXISTS public.image_scout_qa_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  notes text,
  sku_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',  -- running | completed | cancelled
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.image_scout_qa_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "qa_runs auth all" ON public.image_scout_qa_runs;
CREATE POLICY "qa_runs auth all" ON public.image_scout_qa_runs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_qa_runs_updated_at
  BEFORE UPDATE ON public.image_scout_qa_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.image_scout_qa_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.image_scout_qa_runs(id) ON DELETE CASCADE,
  sku text NOT NULL,
  brand text,
  part_number text,
  job_id uuid,
  candidate_id uuid,
  best_candidate_url text,
  source_domain text,
  confidence_score numeric,
  candidates_found int NOT NULL DEFAULT 0,
  status text,                  -- candidate review status (new/approved/etc)
  processing_status text,
  processed_storage_path text,
  safety_flags text[] NOT NULL DEFAULT '{}',
  job_outcome text,             -- result outcome string (success / no_candidate / failed)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qa_items_run ON public.image_scout_qa_run_items(run_id);
CREATE INDEX IF NOT EXISTS idx_qa_items_sku ON public.image_scout_qa_run_items(sku);

ALTER TABLE public.image_scout_qa_run_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "qa_items auth all" ON public.image_scout_qa_run_items;
CREATE POLICY "qa_items auth all" ON public.image_scout_qa_run_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_qa_items_updated_at
  BEFORE UPDATE ON public.image_scout_qa_run_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();