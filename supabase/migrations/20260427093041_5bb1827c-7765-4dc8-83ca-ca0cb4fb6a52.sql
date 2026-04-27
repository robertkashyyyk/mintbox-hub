-- 1. Extend products_cache
ALTER TABLE public.products_cache
  ADD COLUMN IF NOT EXISTS trade_price numeric,
  ADD COLUMN IF NOT EXISTS rrp numeric,
  ADD COLUMN IF NOT EXISTS marketing_title text,
  ADD COLUMN IF NOT EXISTS marketing_description text,
  ADD COLUMN IF NOT EXISTS key_features text[],
  ADD COLUMN IF NOT EXISTS spec_sheet_url text,
  ADD COLUMN IF NOT EXISTS public_visible boolean NOT NULL DEFAULT false;

-- 2. Status enum
DO $$ BEGIN
  CREATE TYPE public.catalogue_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Catalogues
CREATE TABLE IF NOT EXISTS public.catalogues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  cover_image_url text,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.product_categories(id) ON DELETE SET NULL,
  status public.catalogue_status NOT NULL DEFAULT 'draft',
  public_visible boolean NOT NULL DEFAULT false,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_url text,
  pdf_generated_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalogues_status ON public.catalogues(status);
CREATE INDEX IF NOT EXISTS idx_catalogues_brand ON public.catalogues(brand_id);

-- 4. Catalogue items
CREATE TABLE IF NOT EXISTS public.catalogue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogue_id uuid NOT NULL REFERENCES public.catalogues(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products_cache(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  custom_title text,
  custom_description text,
  featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalogue_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_catalogue_items_catalogue ON public.catalogue_items(catalogue_id, display_order);
CREATE INDEX IF NOT EXISTS idx_catalogue_items_product ON public.catalogue_items(product_id);

-- 5. updated_at triggers
DROP TRIGGER IF EXISTS trg_catalogues_updated_at ON public.catalogues;
CREATE TRIGGER trg_catalogues_updated_at
  BEFORE UPDATE ON public.catalogues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_catalogue_items_updated_at ON public.catalogue_items;
CREATE TRIGGER trg_catalogue_items_updated_at
  BEFORE UPDATE ON public.catalogue_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Register as a sidebar/menu area
INSERT INTO public.system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item)
VALUES ('catalogues', 'Catalogues', 'administration', '/admin/catalogues', 'BookOpen', 55, true)
ON CONFLICT (key) DO NOTHING;

-- Grant capabilities to constitutional RBAC roles
INSERT INTO public.role_area_permissions (role, area_key, capability) VALUES
  ('systems_controller', 'catalogues', 'admin'),
  ('commercial_governor', 'catalogues', 'admin'),
  ('inventory_steward', 'catalogues', 'execute'),
  ('executive_viewer', 'catalogues', 'read')
ON CONFLICT (role, area_key) DO UPDATE SET capability = EXCLUDED.capability;

-- 7. RLS
ALTER TABLE public.catalogues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogue_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view published public catalogues"
  ON public.catalogues FOR SELECT
  USING (status = 'published' AND public_visible = true);

CREATE POLICY "Staff can view all catalogues"
  ON public.catalogues FOR SELECT TO authenticated
  USING (public.has_area_capability('catalogues', 'read') OR public.has_role(auth.uid(), 'super_user') OR public.has_role(auth.uid(), 'senior_user'));

CREATE POLICY "Staff can insert catalogues"
  ON public.catalogues FOR INSERT TO authenticated
  WITH CHECK (public.has_area_capability('catalogues', 'propose') OR public.has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]));

CREATE POLICY "Staff can update catalogues"
  ON public.catalogues FOR UPDATE TO authenticated
  USING (public.has_area_capability('catalogues', 'propose') OR public.has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]));

CREATE POLICY "Staff can delete catalogues"
  ON public.catalogues FOR DELETE TO authenticated
  USING (public.has_area_capability('catalogues', 'admin') OR public.has_role(auth.uid(), 'super_user'));

CREATE POLICY "Public can view items of published catalogues"
  ON public.catalogue_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.catalogues c
    WHERE c.id = catalogue_items.catalogue_id
      AND c.status = 'published'
      AND c.public_visible = true
  ));

CREATE POLICY "Staff can view catalogue items"
  ON public.catalogue_items FOR SELECT TO authenticated
  USING (public.has_area_capability('catalogues', 'read') OR public.has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]));

CREATE POLICY "Staff can insert catalogue items"
  ON public.catalogue_items FOR INSERT TO authenticated
  WITH CHECK (public.has_area_capability('catalogues', 'propose') OR public.has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]));

CREATE POLICY "Staff can update catalogue items"
  ON public.catalogue_items FOR UPDATE TO authenticated
  USING (public.has_area_capability('catalogues', 'propose') OR public.has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]));

CREATE POLICY "Staff can delete catalogue items"
  ON public.catalogue_items FOR DELETE TO authenticated
  USING (public.has_area_capability('catalogues', 'propose') OR public.has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]));