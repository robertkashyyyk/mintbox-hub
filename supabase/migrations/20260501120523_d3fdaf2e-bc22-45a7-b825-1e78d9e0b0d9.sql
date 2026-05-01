CREATE OR REPLACE FUNCTION public.refresh_sku_health_now()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]) THEN
    RAISE EXCEPTION 'Forbidden: senior or super role required';
  END IF;
  REFRESH MATERIALIZED VIEW public.sku_velocity;
  REFRESH MATERIALIZED VIEW public.sku_stock_health;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_sku_health_now() TO authenticated;