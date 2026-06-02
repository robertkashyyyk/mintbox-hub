-- ============================================================================
-- Register the Task Manager + Audit Log in the RBAC navigation model.
--
-- The app can run navigation in two modes (app_settings.use_rbac_navigation):
-- the legacy role-flag sidebar, or the data-driven RBAC sidebar that reads
-- system_areas + role_area_permissions. This migration seeds the new areas and
-- a sensible default capability per rbac_role so Tasks shows up in BOTH worlds.
--
-- Idempotent: ON CONFLICT DO UPDATE keeps labels/routes in sync on re-run.
-- ============================================================================

-- ── Areas ────────────────────────────────────────────────────────────────────
INSERT INTO public.system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item) VALUES
  ('tasks',        'Tasks',      NULL,    '/tasks',     'CheckSquare',   60, true),
  ('tasks.today',  'Today',      'tasks', '/tasks',     'CalendarCheck', 61, false),
  ('tasks.my',     'My Tasks',   'tasks', '/tasks/my',  'ListChecks',    62, false),
  ('tasks.all',    'All Tasks',  'tasks', '/tasks/all', 'Users',         63, false),
  ('audit',        'Audit Log',  NULL,    '/audit',     'ClipboardList', 95, true)
ON CONFLICT (key) DO UPDATE
  SET label       = EXCLUDED.label,
      parent_key  = EXCLUDED.parent_key,
      route_path  = EXCLUDED.route_path,
      icon_name   = EXCLUDED.icon_name,
      sort_order  = EXCLUDED.sort_order,
      is_menu_item = EXCLUDED.is_menu_item;

-- ── Default capabilities per role ────────────────────────────────────────────
-- Tasks: everyone who works in the system can execute (create/complete) their
-- own tasks. Audit Log: a read-only governance surface for oversight roles only.
INSERT INTO public.role_area_permissions (role, area_key, capability) VALUES
  -- Tasks — execute for all operating roles, read for the pure viewer.
  ('systems_controller',       'tasks', 'admin'),
  ('commercial_governor',      'tasks', 'execute'),
  ('inventory_steward',        'tasks', 'execute'),
  ('operations_steward',       'tasks', 'execute'),
  ('execution_operator',       'tasks', 'execute'),
  ('customer_service_operator','tasks', 'execute'),
  ('finance_governor',         'tasks', 'execute'),
  ('executive_viewer',         'tasks', 'read'),

  -- Audit Log — governance/oversight roles read; operators have no access.
  ('systems_controller',       'audit', 'admin'),
  ('commercial_governor',      'audit', 'read'),
  ('finance_governor',         'audit', 'read'),
  ('executive_viewer',         'audit', 'read'),
  ('inventory_steward',        'audit', 'none'),
  ('operations_steward',       'audit', 'none'),
  ('execution_operator',       'audit', 'none'),
  ('customer_service_operator','audit', 'none')
ON CONFLICT (role, area_key) DO UPDATE
  SET capability = EXCLUDED.capability;
