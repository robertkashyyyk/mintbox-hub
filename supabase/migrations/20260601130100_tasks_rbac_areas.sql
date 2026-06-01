-- ============================================================================
-- RBAC menu areas for Task Manager & Audit Log (spec §10 build manifest).
-- Registers entries in the RBAC navigation system (system_areas +
-- role_area_permissions) so the RbacSidebar surfaces them for the right roles.
-- Idempotent: ON CONFLICT upserts. Safe to run on a branch first.
--
-- Capability scale (app_capability enum): none | read | propose | execute | admin
-- Roles (rbac_role enum): systems_controller, commercial_governor,
--   inventory_steward, operations_steward, execution_operator,
--   customer_service_operator, finance_governor, executive_viewer
-- ============================================================================

-- ── Menu areas ──────────────────────────────────────────────────────────────
INSERT INTO public.system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item) VALUES
  ('tasks',        'Tasks',     NULL,    '/tasks',     'CheckSquare',   5,  true),
  ('tasks.today',  'Today',     'tasks', '/tasks',     'CheckSquare',   1,  true),
  ('tasks.my',     'My Tasks',  'tasks', '/tasks/my',  'ClipboardList', 2,  true),
  ('tasks.all',    'All Tasks', 'tasks', '/tasks/all', 'ClipboardList', 3,  true),
  ('audit',        'Audit Log', NULL,    '/audit',     'ClipboardList', 95, true)
ON CONFLICT (key) DO UPDATE SET
  label      = EXCLUDED.label,
  parent_key = EXCLUDED.parent_key,
  route_path = EXCLUDED.route_path,
  icon_name  = EXCLUDED.icon_name,
  sort_order = EXCLUDED.sort_order,
  is_menu_item = EXCLUDED.is_menu_item;

-- ── Role permissions ────────────────────────────────────────────────────────
-- Tasks: every operational role can use the task manager (execute = full CRUD
-- on their own tasks). Viewers get read.
INSERT INTO public.role_area_permissions (role, area_key, capability) VALUES
  ('systems_controller',        'tasks',       'admin'),
  ('commercial_governor',       'tasks',       'execute'),
  ('inventory_steward',         'tasks',       'execute'),
  ('operations_steward',        'tasks',       'execute'),
  ('execution_operator',        'tasks',       'execute'),
  ('customer_service_operator', 'tasks',       'execute'),
  ('finance_governor',          'tasks',       'execute'),
  ('executive_viewer',          'tasks',       'read'),
  ('systems_controller',        'tasks.today', 'execute'),
  ('commercial_governor',       'tasks.today', 'execute'),
  ('inventory_steward',         'tasks.today', 'execute'),
  ('operations_steward',        'tasks.today', 'execute'),
  ('execution_operator',        'tasks.today', 'execute'),
  ('customer_service_operator', 'tasks.today', 'execute'),
  ('finance_governor',          'tasks.today', 'execute'),
  ('executive_viewer',          'tasks.today', 'read'),
  ('systems_controller',        'tasks.my',    'execute'),
  ('commercial_governor',       'tasks.my',    'execute'),
  ('inventory_steward',         'tasks.my',    'execute'),
  ('operations_steward',        'tasks.my',    'execute'),
  ('execution_operator',        'tasks.my',    'execute'),
  ('customer_service_operator', 'tasks.my',    'execute'),
  ('finance_governor',          'tasks.my',    'execute'),
  ('executive_viewer',          'tasks.my',    'read'),
  -- All Tasks + Audit Log are oversight surfaces: controllers and finance only.
  ('systems_controller',        'tasks.all',   'admin'),
  ('finance_governor',          'tasks.all',   'read'),
  ('systems_controller',        'audit',       'admin'),
  ('finance_governor',          'audit',       'read'),
  ('executive_viewer',          'audit',       'read')
ON CONFLICT (role, area_key) DO UPDATE SET capability = EXCLUDED.capability;
