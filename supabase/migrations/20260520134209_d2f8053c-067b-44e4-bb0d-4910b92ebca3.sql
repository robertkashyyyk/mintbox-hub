
INSERT INTO public.system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item)
VALUES ('administration.sku_transformations', 'SKU Transformations', 'administration', '/admin/sku-transformations', 'ArrowUpDown', 82, true)
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    parent_key = EXCLUDED.parent_key,
    route_path = EXCLUDED.route_path,
    icon_name = EXCLUDED.icon_name,
    sort_order = EXCLUDED.sort_order,
    is_menu_item = EXCLUDED.is_menu_item;

INSERT INTO public.role_area_permissions (role, area_key, capability) VALUES
  ('systems_controller', 'administration.sku_transformations', 'admin'),
  ('inventory_steward', 'administration.sku_transformations', 'read'),
  ('commercial_governor', 'administration.sku_transformations', 'read'),
  ('finance_governor', 'administration.sku_transformations', 'read')
ON CONFLICT (role, area_key) DO UPDATE SET capability = EXCLUDED.capability;
