-- Add system settings area
INSERT INTO public.system_areas (key, label, parent_key, sort_order, is_menu_item, route_path, icon_name)
VALUES ('administration.settings', 'System Settings', 'administration', 60, true, '/admin/settings', 'Settings')
ON CONFLICT DO NOTHING;

-- Grant admin capability to systems_controller only
INSERT INTO public.role_area_permissions (role, area_key, capability)
VALUES ('systems_controller', 'administration.settings', 'admin')
ON CONFLICT DO NOTHING;