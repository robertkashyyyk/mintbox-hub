-- Add Box Quantities to nav and copy permissions from discovery.products
INSERT INTO public.system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item)
VALUES ('discovery.box_quantities', 'Box Quantities', 'discovery', '/discovery/box-quantities', 'PackagePlus', 75, true)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  parent_key = EXCLUDED.parent_key,
  route_path = EXCLUDED.route_path,
  icon_name = EXCLUDED.icon_name,
  sort_order = EXCLUDED.sort_order,
  is_menu_item = EXCLUDED.is_menu_item;

INSERT INTO public.role_area_permissions (role, area_key, capability)
SELECT role, 'discovery.box_quantities', capability
FROM public.role_area_permissions
WHERE area_key = 'discovery.products'
ON CONFLICT DO NOTHING;