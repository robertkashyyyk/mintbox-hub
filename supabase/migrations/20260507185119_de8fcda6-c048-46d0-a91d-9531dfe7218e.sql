
CREATE TABLE IF NOT EXISTS public.brand_image_profiles (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  preferred_domains text[] NOT NULL DEFAULT '{}',
  blocked_domains text[] NOT NULL DEFAULT '{}',
  search_templates text[] NOT NULL DEFAULT '{}',
  image_rules jsonb NOT NULL DEFAULT '{"prefer_product_only": true, "reject_diagrams": true, "reject_watermarks": true, "prefer_white_background": true}'::jsonb,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.brand_image_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read brand_image_profiles" ON public.brand_image_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff write brand_image_profiles" ON public.brand_image_profiles FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]));
CREATE POLICY "service all brand_image_profiles" ON public.brand_image_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER brand_image_profiles_updated_at BEFORE UPDATE ON public.brand_image_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.image_scout_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.image_scout_jobs(id) ON DELETE CASCADE,
  sku text NOT NULL,
  brand_id uuid,
  source_url text,
  image_url text NOT NULL,
  source_domain text,
  from_template text,
  image_width integer,
  image_height integer,
  confidence_score numeric NOT NULL DEFAULT 0,
  confidence_reasoning jsonb NOT NULL DEFAULT '[]'::jsonb,
  picked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_scout_candidates_sku_idx ON public.image_scout_candidates(sku);
CREATE INDEX IF NOT EXISTS image_scout_candidates_job_idx ON public.image_scout_candidates(job_id);
ALTER TABLE public.image_scout_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read image_scout_candidates" ON public.image_scout_candidates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write image_scout_candidates" ON public.image_scout_candidates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service all image_scout_candidates" ON public.image_scout_candidates FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.brand_image_profile_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('domain', 'template')),
  value text NOT NULL,
  success_count integer NOT NULL DEFAULT 1,
  last_used timestamptz NOT NULL DEFAULT now(),
  promoted boolean NOT NULL DEFAULT false,
  UNIQUE (brand_id, kind, value)
);
CREATE INDEX IF NOT EXISTS brand_image_suggestions_brand_idx ON public.brand_image_profile_suggestions(brand_id, kind);
ALTER TABLE public.brand_image_profile_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read brand_image_suggestions" ON public.brand_image_profile_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff write brand_image_suggestions" ON public.brand_image_profile_suggestions FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]));
CREATE POLICY "service all brand_image_suggestions" ON public.brand_image_profile_suggestions FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item)
VALUES ('discovery.image_scout_brand_profiles', 'Image Scout: Brand Profiles', 'discovery', '/discovery/image-scout/brand-profiles', 'Settings', 18, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_area_permissions (role, area_key, capability)
SELECT r::rbac_role, 'discovery.image_scout_brand_profiles', cap::app_capability
FROM (VALUES
  ('systems_controller', 'admin'),
  ('commercial_governor', 'admin'),
  ('inventory_steward', 'propose')
) AS x(r, cap)
ON CONFLICT DO NOTHING;
