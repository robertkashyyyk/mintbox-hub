-- 1. New Intelligence children
INSERT INTO public.system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item) VALUES
  ('intelligence.profit',        'Profit',        'intelligence', '/intelligence/profit',        'DollarSign',   25, true),
  ('intelligence.missing_costs', 'Missing Costs', 'intelligence', '/intelligence/missing-costs', 'AlertCircle',  26, true),
  ('intelligence.dirt_skus',     'Dirt SKUs',     'intelligence', '/intelligence/dirt-skus',     'AlertTriangle',27, true)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  parent_key = EXCLUDED.parent_key,
  route_path = EXCLUDED.route_path,
  icon_name = EXCLUDED.icon_name,
  sort_order = EXCLUDED.sort_order,
  is_menu_item = true;

-- 2. New Housekeeping group + items (placed between Intelligence and Decisions)
INSERT INTO public.system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item) VALUES
  ('housekeeping',                  'Housekeeping',     NULL,           '/housekeeping',               'ListTodo',     25, true),
  ('housekeeping.overview',         'Overview',         'housekeeping', '/housekeeping',               'ListTodo',     1,  true),
  ('housekeeping.missing_costs',    'Missing Costs',    'housekeeping', '/intelligence/missing-costs', 'AlertCircle',  2,  true),
  ('housekeeping.dirt_skus',        'Dirt SKUs',        'housekeeping', '/intelligence/dirt-skus',     'AlertTriangle',3,  true),
  ('housekeeping.pending_images',   'Pending Images',   'housekeeping', '/discovery/pending-images',   'Upload',       4,  true),
  ('housekeeping.discovery_queue',  'Discovery Queue',  'housekeeping', '/discovery/discovery-queue',  'Search',       5,  true)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  parent_key = EXCLUDED.parent_key,
  route_path = EXCLUDED.route_path,
  icon_name = EXCLUDED.icon_name,
  sort_order = EXCLUDED.sort_order,
  is_menu_item = true;

-- 3. Mirror the existing Intelligence grants onto the new Intelligence children
INSERT INTO public.role_area_permissions (area_key, role, capability)
SELECT new_key, role, capability
FROM public.role_area_permissions r
CROSS JOIN (VALUES ('intelligence.profit'),('intelligence.missing_costs'),('intelligence.dirt_skus')) AS t(new_key)
WHERE r.area_key = 'intelligence.stock_health'
ON CONFLICT (area_key, role) DO NOTHING;

-- 4. Grant Housekeeping group + children to the same roles that see Intelligence
INSERT INTO public.role_area_permissions (area_key, role, capability)
SELECT new_key, role, capability
FROM public.role_area_permissions r
CROSS JOIN (VALUES
  ('housekeeping'),
  ('housekeeping.overview'),
  ('housekeeping.missing_costs'),
  ('housekeeping.dirt_skus'),
  ('housekeeping.pending_images'),
  ('housekeeping.discovery_queue')
) AS t(new_key)
WHERE r.area_key = 'intelligence'
ON CONFLICT (area_key, role) DO NOTHING;