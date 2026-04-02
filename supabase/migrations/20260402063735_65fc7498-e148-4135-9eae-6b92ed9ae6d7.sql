-- Add Order Telemetry to Operations in system_areas
INSERT INTO system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item)
VALUES ('operations.order_telemetry', 'Order Telemetry', 'operations', '/operations/order-telemetry', 'Activity', 52, true)
ON CONFLICT (key) DO UPDATE SET parent_key = 'operations', route_path = '/operations/order-telemetry', sort_order = 52;

-- Bump existing operations children sort order to make room
UPDATE system_areas SET sort_order = 53 WHERE key = 'operations.reports';
UPDATE system_areas SET sort_order = 54 WHERE key = 'operations.monitoring';

-- Fix Price Hunter route path
UPDATE system_areas SET route_path = '/execution/price-hunter' WHERE key = 'execution.price_hunter';

-- Remove legacy sales_orders entry
DELETE FROM system_areas WHERE key = 'execution.sales_orders';

-- Copy permissions to new key
INSERT INTO role_area_permissions (role, area_key, capability)
SELECT role, 'operations.order_telemetry', capability
FROM role_area_permissions
WHERE area_key = 'execution.sales_orders'
ON CONFLICT DO NOTHING;

-- Clean up old permissions
DELETE FROM role_area_permissions WHERE area_key = 'execution.sales_orders';