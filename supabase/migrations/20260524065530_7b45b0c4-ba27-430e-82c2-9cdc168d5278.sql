CREATE OR REPLACE FUNCTION public.refresh_sku_health_internal()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.sku_stock_health;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_sku_health_internal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_sku_health_internal() TO service_role;