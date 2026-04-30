
-- Remove duplicate Monitoring menu item (Dashboard already covers it)
UPDATE public.system_areas SET is_menu_item = false WHERE key = 'operations.monitoring';

-- Reorder Operations sub-items to match OperationsIndex tile order
UPDATE public.system_areas SET sort_order = 10 WHERE key = 'operations.dashboard';
UPDATE public.system_areas SET sort_order = 20 WHERE key = 'operations.trends';
UPDATE public.system_areas SET sort_order = 30 WHERE key = 'operations.sku_analysis';
UPDATE public.system_areas SET sort_order = 40 WHERE key = 'operations.order_telemetry';
UPDATE public.system_areas SET sort_order = 50 WHERE key = 'operations.carriers';
UPDATE public.system_areas SET sort_order = 60 WHERE key = 'operations.reports';
