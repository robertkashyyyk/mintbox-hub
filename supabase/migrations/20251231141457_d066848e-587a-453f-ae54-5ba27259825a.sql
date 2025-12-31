
-- Phase 1: Constitutional RBAC System (Parallel to existing app_role)

-- 1. Create new enums (keeping existing app_role untouched)
DO $$ BEGIN
  CREATE TYPE public.rbac_role AS ENUM (
    'systems_controller',
    'commercial_governor',
    'inventory_steward',
    'operations_steward',
    'execution_operator',
    'customer_service_operator',
    'finance_governor',
    'executive_viewer'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.app_capability AS ENUM (
    'none',
    'read',
    'propose',
    'execute',
    'admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Create RBAC tables

-- Multi-role assignments (parallel to user_roles)
CREATE TABLE IF NOT EXISTS public.user_rbac_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role rbac_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Constitutional role conflicts
CREATE TABLE IF NOT EXISTS public.role_conflicts (
  role_a rbac_role NOT NULL,
  role_b rbac_role NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY (role_a, role_b)
);

-- System areas (menu/page definitions)
CREATE TABLE IF NOT EXISTS public.system_areas (
  key text PRIMARY KEY,
  label text NOT NULL,
  parent_key text REFERENCES public.system_areas(key),
  route_path text,
  icon_name text,
  sort_order int NOT NULL DEFAULT 100,
  is_menu_item boolean NOT NULL DEFAULT true
);

-- Role permissions per area
CREATE TABLE IF NOT EXISTS public.role_area_permissions (
  role rbac_role NOT NULL,
  area_key text NOT NULL REFERENCES public.system_areas(key) ON DELETE CASCADE,
  capability app_capability NOT NULL DEFAULT 'none',
  PRIMARY KEY (role, area_key)
);

-- App settings for feature flags
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT 'false'::jsonb,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Create helper functions

-- Capability ranking for comparison
CREATE OR REPLACE FUNCTION public.capability_rank(c app_capability)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE c
    WHEN 'none' THEN 0
    WHEN 'read' THEN 1
    WHEN 'propose' THEN 2
    WHEN 'execute' THEN 3
    WHEN 'admin' THEN 4
  END;
$$;

-- Get user's best capability for an area
CREATE OR REPLACE FUNCTION public.user_area_capability(area_key text, uid uuid DEFAULT auth.uid())
RETURNS app_capability
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT rap.capability
    FROM public.user_rbac_roles ur
    JOIN public.role_area_permissions rap
      ON rap.role = ur.role
    WHERE ur.user_id = uid
      AND ur.is_active = true
      AND rap.area_key = user_area_capability.area_key
    ORDER BY public.capability_rank(rap.capability) DESC
    LIMIT 1
  ), 'none'::app_capability);
$$;

-- Check if user has minimum capability for an area
CREATE OR REPLACE FUNCTION public.has_area_capability(area_key text, min_capability app_capability, uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.capability_rank(public.user_area_capability(area_key, uid)) >= public.capability_rank(min_capability);
$$;

-- 4. Create conflict prevention trigger
CREATE OR REPLACE FUNCTION public.prevent_conflicting_rbac_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conflict_record RECORD;
BEGIN
  IF NEW.is_active IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  SELECT rc.role_b, rc.reason INTO conflict_record
  FROM public.user_rbac_roles ur
  JOIN public.role_conflicts rc
    ON rc.role_a = NEW.role AND rc.role_b = ur.role
  WHERE ur.user_id = NEW.user_id
    AND ur.is_active = true
    AND ur.id IS DISTINCT FROM NEW.id
  LIMIT 1;

  IF conflict_record IS NOT NULL THEN
    RAISE EXCEPTION 'Role conflict: % cannot be combined with % - %', 
      NEW.role, conflict_record.role_b, conflict_record.reason
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_conflicting_rbac_roles ON public.user_rbac_roles;
CREATE TRIGGER trg_prevent_conflicting_rbac_roles
BEFORE INSERT OR UPDATE ON public.user_rbac_roles
FOR EACH ROW EXECUTE FUNCTION public.prevent_conflicting_rbac_roles();

-- 5. Create menu view for current user
CREATE OR REPLACE VIEW public.menu_for_user AS
SELECT
  sa.key,
  sa.label,
  sa.parent_key,
  sa.route_path,
  sa.icon_name,
  sa.sort_order,
  public.user_area_capability(sa.key) AS capability
FROM public.system_areas sa
WHERE sa.is_menu_item = true
  AND public.user_area_capability(sa.key) <> 'none'::app_capability
ORDER BY sa.sort_order;

-- 6. Seed system_areas
INSERT INTO public.system_areas(key, label, parent_key, route_path, icon_name, sort_order, is_menu_item) VALUES
  -- Discovery
  ('discovery', 'Discovery', NULL, '/discovery', 'Search', 10, true),
  ('discovery.products', 'Products', 'discovery', '/sku-database', 'Package', 11, true),
  ('discovery.brands', 'Brands', 'discovery', '/brands', 'Tags', 12, true),
  ('discovery.queue', 'Discovery Queue', 'discovery', '/discovery/queue', 'ListTodo', 13, true),
  ('discovery.importing', 'Importing', 'discovery', '/importing', 'Upload', 14, true),
  
  -- Intelligence
  ('intelligence', 'Intelligence', NULL, '/intelligence', 'Brain', 20, true),
  ('intelligence.velocity_coverage', 'Velocity & Coverage', 'intelligence', '/intelligence/velocity-coverage', 'TrendingUp', 21, true),
  ('intelligence.stock_health', 'Stock Health', 'intelligence', '/intelligence/stock-health', 'HeartPulse', 22, true),
  ('intelligence.pricing_signals', 'Pricing Signals', 'intelligence', '/intelligence/pricing-signals', 'DollarSign', 23, true),
  ('intelligence.seasonality', 'Seasonality', 'intelligence', '/intelligence/seasonality', 'Calendar', 24, true),
  
  -- Decisions
  ('decisions', 'Decisions', NULL, '/decisions', 'Scale', 30, true),
  ('decisions.buy_recommendations', 'Buy Recommendations', 'decisions', '/decisions/buy-recommendations', 'ShoppingCart', 31, true),
  ('decisions.liquidation_candidates', 'Liquidation', 'decisions', '/decisions/liquidation', 'Trash2', 32, true),
  ('decisions.price_moves', 'Price Moves', 'decisions', '/decisions/price-moves', 'ArrowUpDown', 33, true),
  ('decisions.bundle_suggestions', 'Bundles', 'decisions', '/decisions/bundles', 'Package2', 34, true),
  
  -- Execution
  ('execution', 'Execution', NULL, '/execution', 'Zap', 40, true),
  ('execution.price_hunter', 'Price Hunter', 'execution', '/price-hunter', 'Crosshair', 41, true),
  ('execution.remote_stock_updates', 'Remote Stock', 'execution', '/remote-stock-updates', 'RefreshCw', 42, true),
  ('execution.ebay_clone', 'Listing Cloner', 'execution', '/ebay-clone', 'Copy', 43, true),
  ('execution.sales_orders', 'Sales Orders', 'execution', '/sales-orders', 'ClipboardList', 44, true),
  
  -- Operations
  ('operations', 'Operations', NULL, '/operations', 'Activity', 50, true),
  ('operations.dashboard', 'Dashboard', 'operations', '/operations/dashboard', 'LayoutDashboard', 51, true),
  ('operations.reports', 'Reports', 'operations', '/operations/reports', 'FileText', 52, true),
  ('operations.monitoring', 'Monitoring', 'operations', '/operations/monitoring', 'Monitor', 53, true),
  
  -- Administration
  ('administration', 'Administration', NULL, '/admin', 'Shield', 60, true),
  ('administration.user_management', 'User Management', 'administration', '/admin/users', 'Users', 61, true),
  ('administration.api_access', 'API Access', 'administration', '/admin/api', 'Key', 62, true),
  ('administration.billing_usage', 'Billing & Usage', 'administration', '/admin/billing', 'CreditCard', 63, true),
  ('administration.logs', 'Logs & Diagnostics', 'administration', '/admin/logs', 'Terminal', 64, true),
  
  -- Dashboards (display screens)
  ('dashboards', 'Dashboards', NULL, '/dashboards', 'Monitor', 70, true),
  ('dashboards.packing', 'Packing Area', 'dashboards', '/dashboards/packing-area', 'Package', 71, true),
  ('dashboards.warehouse', 'Warehouse', 'dashboards', '/dashboards/warehouse-performance', 'Warehouse', 72, true),
  ('dashboards.weekly', 'Weekly Summary', 'dashboards', '/dashboards/weekly-summary', 'CalendarDays', 73, true)
ON CONFLICT (key) DO NOTHING;

-- 7. Seed role conflicts (both directions)
INSERT INTO public.role_conflicts(role_a, role_b, reason) VALUES
  ('commercial_governor', 'execution_operator', 'Revenue influences rules, not buttons'),
  ('execution_operator', 'commercial_governor', 'Revenue influences rules, not buttons'),
  ('customer_service_operator', 'inventory_steward', 'Customer service never fixes ops/stock'),
  ('inventory_steward', 'customer_service_operator', 'Customer service never fixes ops/stock'),
  ('finance_governor', 'execution_operator', 'Finance does not execute ops'),
  ('execution_operator', 'finance_governor', 'Finance does not execute ops'),
  ('executive_viewer', 'execution_operator', 'Oversight without interference'),
  ('execution_operator', 'executive_viewer', 'Oversight without interference'),
  ('executive_viewer', 'commercial_governor', 'Oversight without interference'),
  ('commercial_governor', 'executive_viewer', 'Oversight without interference')
ON CONFLICT DO NOTHING;

-- 8. Seed role_area_permissions

-- Systems Controller: admin everywhere
INSERT INTO public.role_area_permissions(role, area_key, capability)
SELECT 'systems_controller'::rbac_role, key, 'admin'::app_capability
FROM public.system_areas
ON CONFLICT DO NOTHING;

-- Commercial Governor
INSERT INTO public.role_area_permissions(role, area_key, capability) VALUES
  ('commercial_governor', 'discovery', 'read'),
  ('commercial_governor', 'discovery.products', 'read'),
  ('commercial_governor', 'discovery.brands', 'read'),
  ('commercial_governor', 'discovery.queue', 'read'),
  ('commercial_governor', 'discovery.importing', 'read'),
  ('commercial_governor', 'intelligence', 'read'),
  ('commercial_governor', 'intelligence.velocity_coverage', 'read'),
  ('commercial_governor', 'intelligence.stock_health', 'read'),
  ('commercial_governor', 'intelligence.pricing_signals', 'read'),
  ('commercial_governor', 'intelligence.seasonality', 'read'),
  ('commercial_governor', 'decisions', 'propose'),
  ('commercial_governor', 'decisions.buy_recommendations', 'propose'),
  ('commercial_governor', 'decisions.liquidation_candidates', 'propose'),
  ('commercial_governor', 'decisions.price_moves', 'propose'),
  ('commercial_governor', 'decisions.bundle_suggestions', 'propose'),
  ('commercial_governor', 'operations', 'read'),
  ('commercial_governor', 'operations.dashboard', 'read'),
  ('commercial_governor', 'operations.monitoring', 'read'),
  ('commercial_governor', 'operations.reports', 'read')
ON CONFLICT DO NOTHING;

-- Inventory Steward
INSERT INTO public.role_area_permissions(role, area_key, capability) VALUES
  ('inventory_steward', 'discovery', 'read'),
  ('inventory_steward', 'discovery.products', 'read'),
  ('inventory_steward', 'discovery.brands', 'read'),
  ('inventory_steward', 'discovery.importing', 'read'),
  ('inventory_steward', 'intelligence', 'read'),
  ('inventory_steward', 'intelligence.velocity_coverage', 'read'),
  ('inventory_steward', 'intelligence.stock_health', 'read'),
  ('inventory_steward', 'intelligence.pricing_signals', 'read'),
  ('inventory_steward', 'intelligence.seasonality', 'read'),
  ('inventory_steward', 'decisions', 'propose'),
  ('inventory_steward', 'decisions.buy_recommendations', 'propose'),
  ('inventory_steward', 'operations', 'read'),
  ('inventory_steward', 'operations.dashboard', 'read'),
  ('inventory_steward', 'operations.monitoring', 'read'),
  ('inventory_steward', 'operations.reports', 'read')
ON CONFLICT DO NOTHING;

-- Operations Steward
INSERT INTO public.role_area_permissions(role, area_key, capability) VALUES
  ('operations_steward', 'operations', 'read'),
  ('operations_steward', 'operations.dashboard', 'read'),
  ('operations_steward', 'operations.monitoring', 'read'),
  ('operations_steward', 'operations.reports', 'read'),
  ('operations_steward', 'dashboards', 'read'),
  ('operations_steward', 'dashboards.packing', 'read'),
  ('operations_steward', 'dashboards.warehouse', 'read'),
  ('operations_steward', 'dashboards.weekly', 'read')
ON CONFLICT DO NOTHING;

-- Execution Operator
INSERT INTO public.role_area_permissions(role, area_key, capability) VALUES
  ('execution_operator', 'execution', 'execute'),
  ('execution_operator', 'execution.price_hunter', 'execute'),
  ('execution_operator', 'execution.remote_stock_updates', 'execute'),
  ('execution_operator', 'execution.ebay_clone', 'execute'),
  ('execution_operator', 'execution.sales_orders', 'execute'),
  ('execution_operator', 'operations', 'read'),
  ('execution_operator', 'operations.dashboard', 'read'),
  ('execution_operator', 'operations.monitoring', 'read'),
  ('execution_operator', 'dashboards', 'read'),
  ('execution_operator', 'dashboards.packing', 'read'),
  ('execution_operator', 'dashboards.warehouse', 'read')
ON CONFLICT DO NOTHING;

-- Customer Service Operator
INSERT INTO public.role_area_permissions(role, area_key, capability) VALUES
  ('customer_service_operator', 'operations', 'read'),
  ('customer_service_operator', 'operations.dashboard', 'read'),
  ('customer_service_operator', 'operations.monitoring', 'read'),
  ('customer_service_operator', 'operations.reports', 'read')
ON CONFLICT DO NOTHING;

-- Finance Governor
INSERT INTO public.role_area_permissions(role, area_key, capability) VALUES
  ('finance_governor', 'operations', 'read'),
  ('finance_governor', 'operations.dashboard', 'read'),
  ('finance_governor', 'operations.reports', 'read'),
  ('finance_governor', 'administration', 'read'),
  ('finance_governor', 'administration.billing_usage', 'read'),
  ('finance_governor', 'administration.logs', 'read'),
  ('finance_governor', 'intelligence', 'read'),
  ('finance_governor', 'intelligence.velocity_coverage', 'read'),
  ('finance_governor', 'intelligence.stock_health', 'read'),
  ('finance_governor', 'decisions', 'read'),
  ('finance_governor', 'decisions.buy_recommendations', 'read'),
  ('finance_governor', 'decisions.liquidation_candidates', 'read'),
  ('finance_governor', 'decisions.price_moves', 'read')
ON CONFLICT DO NOTHING;

-- Executive Viewer
INSERT INTO public.role_area_permissions(role, area_key, capability) VALUES
  ('executive_viewer', 'operations', 'read'),
  ('executive_viewer', 'operations.dashboard', 'read'),
  ('executive_viewer', 'operations.reports', 'read'),
  ('executive_viewer', 'dashboards', 'read'),
  ('executive_viewer', 'dashboards.weekly', 'read')
ON CONFLICT DO NOTHING;

-- 9. Seed feature flag
INSERT INTO public.app_settings(key, value, description) VALUES
  ('use_rbac_navigation', 'false'::jsonb, 'When true, sidebar uses RBAC permissions instead of legacy roles')
ON CONFLICT (key) DO NOTHING;

-- 10. Enable RLS on new tables
ALTER TABLE public.user_rbac_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_area_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- 11. RLS Policies for user_rbac_roles
CREATE POLICY "Users can view their own RBAC roles"
ON public.user_rbac_roles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Systems controllers can view all RBAC roles"
ON public.user_rbac_roles FOR SELECT
USING (public.user_area_capability('administration.user_management') = 'admin');

CREATE POLICY "Systems controllers can manage RBAC roles"
ON public.user_rbac_roles FOR ALL
USING (public.user_area_capability('administration.user_management') = 'admin');

-- Allow legacy super_user to manage RBAC roles (bootstrap access)
CREATE POLICY "Legacy super users can manage RBAC roles"
ON public.user_rbac_roles FOR ALL
USING (public.has_role(auth.uid(), 'super_user'));

-- 12. RLS Policies for reference tables (read-only for authenticated)
CREATE POLICY "Authenticated users can view role conflicts"
ON public.role_conflicts FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view system areas"
ON public.system_areas FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view role permissions"
ON public.role_area_permissions FOR SELECT
USING (auth.role() = 'authenticated');

-- 13. RLS Policies for app_settings
CREATE POLICY "Authenticated users can view app settings"
ON public.app_settings FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Systems controllers can manage app settings"
ON public.app_settings FOR ALL
USING (public.user_area_capability('administration') = 'admin');

CREATE POLICY "Legacy super users can manage app settings"
ON public.app_settings FOR ALL
USING (public.has_role(auth.uid(), 'super_user'));
