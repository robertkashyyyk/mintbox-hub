
-- Fix all RBAC system_areas routes to match canonical paths

-- Discovery children
UPDATE system_areas SET route_path = '/discovery/products' WHERE key = 'discovery.products';
UPDATE system_areas SET route_path = '/discovery/brands' WHERE key = 'discovery.brands';
UPDATE system_areas SET route_path = '/discovery/discovery-queue' WHERE key = 'discovery.queue';
UPDATE system_areas SET route_path = '/discovery/feed-imports', label = 'Feed Imports' WHERE key = 'discovery.importing';

-- Add missing Discovery items
INSERT INTO system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item)
VALUES 
  ('discovery.bulk_images', 'Bulk Image Upload', 'discovery', '/discovery/bulk-images', 'Upload', 15, true),
  ('discovery.pending_images', 'Pending Images', 'discovery', '/discovery/pending-images', 'Clock', 16, true)
ON CONFLICT (key) DO UPDATE SET route_path = EXCLUDED.route_path, label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Intelligence children
UPDATE system_areas SET route_path = '/intelligence/velocity' WHERE key = 'intelligence.velocity_coverage';
UPDATE system_areas SET route_path = '/intelligence/pricing' WHERE key = 'intelligence.pricing_signals';

-- Decisions children
UPDATE system_areas SET route_path = '/decisions/buying' WHERE key = 'decisions.buy_recommendations';

-- Execution children
UPDATE system_areas SET route_path = '/execution/remote-stock-updates', label = 'Remote Stock Updates' WHERE key = 'execution.remote_stock_updates';
UPDATE system_areas SET route_path = '/execution/listing-cloner', label = 'Listing Cloner' WHERE key = 'execution.ebay_clone';

-- Add missing Execution item: Purchase Order Builder
INSERT INTO system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item)
VALUES ('execution.purchase_orders', 'Purchase Order Builder', 'execution', '/execution/purchase-orders', 'ShoppingCart', 40, true)
ON CONFLICT (key) DO UPDATE SET route_path = EXCLUDED.route_path, label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Reorder execution items
UPDATE system_areas SET sort_order = 41 WHERE key = 'execution.price_hunter';
UPDATE system_areas SET sort_order = 42 WHERE key = 'execution.remote_stock_updates';
UPDATE system_areas SET sort_order = 43 WHERE key = 'execution.ebay_clone';

-- Administration children
UPDATE system_areas SET route_path = '/admin/api-keys' WHERE key = 'administration.api_access';

-- Add missing Administration item: Integrations
INSERT INTO system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item)
VALUES ('administration.integrations', 'Integrations', 'administration', '/admin/integrations', 'RefreshCw', 65, true)
ON CONFLICT (key) DO UPDATE SET route_path = EXCLUDED.route_path, label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- Dashboards children
UPDATE system_areas SET route_path = '/dashboards/packing' WHERE key = 'dashboards.packing';
UPDATE system_areas SET route_path = '/dashboards/warehouse', label = 'Warehouse Performance' WHERE key = 'dashboards.warehouse';
UPDATE system_areas SET route_path = '/dashboards/weekly' WHERE key = 'dashboards.weekly';

-- Copy permissions for new items from their parent modules
INSERT INTO role_area_permissions (role, area_key, capability)
SELECT rap.role, new_key.key, rap.capability
FROM role_area_permissions rap
CROSS JOIN (VALUES 
  ('discovery', 'discovery.bulk_images'),
  ('discovery', 'discovery.pending_images'),
  ('execution', 'execution.purchase_orders'),
  ('administration', 'administration.integrations')
) AS new_key(parent, key)
WHERE rap.area_key = new_key.parent
ON CONFLICT DO NOTHING;
