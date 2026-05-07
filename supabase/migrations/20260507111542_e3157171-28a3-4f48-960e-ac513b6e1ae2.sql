-- Image Scout: agent-style image discovery for SKUs missing images

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS image_url_pattern text,
  ADD COLUMN IF NOT EXISTS image_search_domain text;

COMMENT ON COLUMN public.brands.image_url_pattern IS 'Optional URL pattern with {sku} placeholder used by Image Scout Mode 1';
COMMENT ON COLUMN public.brands.image_search_domain IS 'Domain (e.g. supplier.com) for Firecrawl site-scoped fallback search';

CREATE TABLE IF NOT EXISTS public.image_scout_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  mode text NOT NULL CHECK (mode IN ('targeted','open_search')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','failed','needs_review')),
  source_url text,
  override_search_term text,
  attempts int NOT NULL DEFAULT 0,
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_image_scout_jobs_status ON public.image_scout_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_image_scout_jobs_sku ON public.image_scout_jobs(sku);

CREATE TABLE IF NOT EXISTS public.image_scout_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.image_scout_jobs(id) ON DELETE CASCADE,
  sku text NOT NULL,
  source_page_url text,
  source_image_url text,
  raw_width int,
  raw_height int,
  outcome text NOT NULL CHECK (outcome IN ('stored','low_res','watermark_review','no_match','error','approved','rejected')),
  storage_path text,
  watermark_score numeric,
  notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_image_scout_results_outcome ON public.image_scout_results(outcome, created_at);
CREATE INDEX IF NOT EXISTS idx_image_scout_results_sku ON public.image_scout_results(sku);

ALTER TABLE public.image_scout_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_scout_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authed read jobs" ON public.image_scout_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authed insert jobs" ON public.image_scout_jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authed update jobs" ON public.image_scout_jobs FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authed delete jobs" ON public.image_scout_jobs FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'super_user'));

CREATE POLICY "Authed read results" ON public.image_scout_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authed insert results" ON public.image_scout_results FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authed update results" ON public.image_scout_results FOR UPDATE TO authenticated USING (true);

-- Add area to RBAC
INSERT INTO public.system_areas (key, parent_key, label, route_path, icon_name, sort_order)
VALUES ('discovery.image_scout','discovery','Image Scout','/discovery/image-scout','Sparkles', 17)
ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, route_path=EXCLUDED.route_path, icon_name=EXCLUDED.icon_name, sort_order=EXCLUDED.sort_order;

INSERT INTO public.role_area_permissions (role, area_key, capability) VALUES
  ('systems_controller','discovery.image_scout','admin'),
  ('inventory_steward','discovery.image_scout','execute'),
  ('commercial_governor','discovery.image_scout','read')
ON CONFLICT (role, area_key) DO UPDATE SET capability=EXCLUDED.capability;