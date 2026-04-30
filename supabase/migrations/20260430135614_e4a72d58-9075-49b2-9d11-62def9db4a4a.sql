
-- ============================================================
-- Carriers module — Phase 1 schema
-- ============================================================

-- 1. carriers
CREATE TABLE IF NOT EXISTS public.carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.carriers (name, slug)
VALUES ('Royal Mail', 'royal-mail')
ON CONFLICT (slug) DO NOTHING;

-- 2. carrier_documents
CREATE TABLE IF NOT EXISTS public.carrier_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE RESTRICT,
  doc_type text NOT NULL CHECK (doc_type IN ('invoice','penalty_notice','claim','other')),
  document_date date NOT NULL,
  period_start date,
  period_end date,
  file_path text NOT NULL,
  file_url text,
  total_amount numeric(12,2),
  parse_status text NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending','parsing','parsed','failed','manual')),
  parse_error text,
  parsed_at timestamptz,
  uploaded_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carrier_documents_carrier ON public.carrier_documents(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_documents_date ON public.carrier_documents(document_date DESC);

-- 3. carrier_penalties
CREATE TABLE IF NOT EXISTS public.carrier_penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.carrier_documents(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE RESTRICT,
  tracking_number text,
  penalty_amount numeric(12,2) NOT NULL DEFAULT 0,
  reason_code text,
  reason_text text,
  declared_format text,
  actual_format text,
  penalty_date date,
  mintsoft_order_id integer,
  sku text,
  resolution_status text NOT NULL DEFAULT 'unresolved'
    CHECK (resolution_status IN ('unresolved','order_found','sku_found','remeasure_pending','remeasured','packer_issue','written_off')),
  resolved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carrier_penalties_document ON public.carrier_penalties(document_id);
CREATE INDEX IF NOT EXISTS idx_carrier_penalties_tracking ON public.carrier_penalties(tracking_number);
CREATE INDEX IF NOT EXISTS idx_carrier_penalties_sku ON public.carrier_penalties(sku);
CREATE INDEX IF NOT EXISTS idx_carrier_penalties_date ON public.carrier_penalties(penalty_date DESC);
CREATE INDEX IF NOT EXISTS idx_carrier_penalties_status ON public.carrier_penalties(resolution_status);

-- 4. carrier_remeasure_tasks
CREATE TABLE IF NOT EXISTS public.carrier_remeasure_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  penalty_id uuid REFERENCES public.carrier_penalties(id) ON DELETE CASCADE,
  sku text NOT NULL,
  mintsoft_order_id integer,
  assigned_to text,
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','done','escalated','packer_issue')),
  old_category text,
  new_category text,
  old_dimensions jsonb,
  new_dimensions jsonb,
  completed_at timestamptz,
  completed_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carrier_remeasure_sku ON public.carrier_remeasure_tasks(sku);
CREATE INDEX IF NOT EXISTS idx_carrier_remeasure_status ON public.carrier_remeasure_tasks(status);
CREATE INDEX IF NOT EXISTS idx_carrier_remeasure_assigned ON public.carrier_remeasure_tasks(assigned_to);

-- 5. order_lines.tracking_number
ALTER TABLE public.order_lines
  ADD COLUMN IF NOT EXISTS tracking_number text;

CREATE INDEX IF NOT EXISTS idx_order_lines_tracking ON public.order_lines(tracking_number)
  WHERE tracking_number IS NOT NULL;

-- 6. updated_at triggers
DROP TRIGGER IF EXISTS trg_carrier_documents_updated_at ON public.carrier_documents;
CREATE TRIGGER trg_carrier_documents_updated_at
  BEFORE UPDATE ON public.carrier_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_carrier_penalties_updated_at ON public.carrier_penalties;
CREATE TRIGGER trg_carrier_penalties_updated_at
  BEFORE UPDATE ON public.carrier_penalties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_carrier_remeasure_updated_at ON public.carrier_remeasure_tasks;
CREATE TRIGGER trg_carrier_remeasure_updated_at
  BEFORE UPDATE ON public.carrier_remeasure_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 7. Enable RLS
ALTER TABLE public.carriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrier_remeasure_tasks ENABLE ROW LEVEL SECURITY;

-- 8. Policies — carriers
CREATE POLICY "auth read carriers" ON public.carriers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff write carriers" ON public.carriers
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
CREATE POLICY "service all carriers" ON public.carriers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Policies — carrier_documents
CREATE POLICY "auth read carrier_documents" ON public.carrier_documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff write carrier_documents" ON public.carrier_documents
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
CREATE POLICY "service all carrier_documents" ON public.carrier_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Policies — carrier_penalties
CREATE POLICY "auth read carrier_penalties" ON public.carrier_penalties
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff write carrier_penalties" ON public.carrier_penalties
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
CREATE POLICY "service all carrier_penalties" ON public.carrier_penalties
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Policies — carrier_remeasure_tasks
CREATE POLICY "auth read carrier_remeasure_tasks" ON public.carrier_remeasure_tasks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff write carrier_remeasure_tasks" ON public.carrier_remeasure_tasks
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
CREATE POLICY "service all carrier_remeasure_tasks" ON public.carrier_remeasure_tasks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 9. Storage bucket for carrier documents (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('carrier-documents', 'carrier-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "auth read carrier-documents bucket"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'carrier-documents');

CREATE POLICY "staff write carrier-documents bucket"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'carrier-documents'
    AND has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));

CREATE POLICY "staff update carrier-documents bucket"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'carrier-documents'
    AND has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));

CREATE POLICY "staff delete carrier-documents bucket"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'carrier-documents'
    AND has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
