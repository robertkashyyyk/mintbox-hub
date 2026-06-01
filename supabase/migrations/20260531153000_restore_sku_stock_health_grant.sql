-- Restore SELECT grant on sku_stock_health materialized view for authenticated users.
-- The May 7 migration (20260507114556) dropped and recreated the MV but did not
-- re-add the GRANT, leaving authenticated users unable to query it directly.
-- Also grant SELECT on get_stock_health_summary so the summary RPC is visible.

GRANT SELECT ON public.sku_stock_health TO authenticated;

-- Ensure the summary RPC and refresh_sku_health_now are callable by authenticated users.
-- (refresh_sku_health_internal stays service_role-only per the security model.)
GRANT EXECUTE ON FUNCTION public.get_stock_health_summary TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_sku_health_now TO authenticated;
