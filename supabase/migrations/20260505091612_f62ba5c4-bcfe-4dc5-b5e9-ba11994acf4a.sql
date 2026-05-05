-- Register Suppliers area + permissions so it surfaces in the RBAC sidebar
INSERT INTO public.system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item)
VALUES ('administration.suppliers', 'Suppliers', 'administration', '/admin/suppliers', 'Truck', 80, true)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  parent_key = EXCLUDED.parent_key,
  route_path = EXCLUDED.route_path,
  icon_name = EXCLUDED.icon_name,
  sort_order = EXCLUDED.sort_order,
  is_menu_item = EXCLUDED.is_menu_item;

INSERT INTO public.role_area_permissions (role, area_key, capability) VALUES
  ('systems_controller', 'administration.suppliers', 'admin'),
  ('inventory_steward', 'administration.suppliers', 'admin'),
  ('commercial_governor', 'administration.suppliers', 'read'),
  ('finance_governor', 'administration.suppliers', 'read'),
  ('operations_steward', 'administration.suppliers', 'read')
ON CONFLICT (role, area_key) DO UPDATE SET capability = EXCLUDED.capability;