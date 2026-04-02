
INSERT INTO role_area_permissions (role, area_key, capability)
SELECT role, 'operations.order_telemetry', capability
FROM role_area_permissions
WHERE area_key = 'operations.dashboard'
ON CONFLICT DO NOTHING;
