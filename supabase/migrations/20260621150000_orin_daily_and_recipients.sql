-- Orin daily redesign + email recipients.
--
-- 1) get_profit_day — yesterday's headline trading figures (revenue / orders / profit),
--    defined identically to get_profit_week (revenue = SUM(order_value), orders = distinct
--    mintsoft_order_id, profit = SUM(profit)) but at day grain. UK-day boundaries.
-- 2) Orin email recipients + cadences (read by the orin-report function; change anytime here).

CREATE OR REPLACE FUNCTION public.get_profit_day(
  p_date date DEFAULT ((now() AT TIME ZONE 'Europe/London')::date - 1)
)
RETURNS TABLE(day date, revenue numeric, orders bigint, profit numeric, por_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p_date,
    COALESCE(SUM(order_value), 0)::numeric,
    COUNT(DISTINCT mintsoft_order_id)::bigint,
    COALESCE(SUM(profit), 0)::numeric,
    CASE WHEN SUM(order_value * 1.2) > 0
      THEN ROUND((SUM(profit) / SUM(order_value * 1.2))::numeric, 4)
      ELSE NULL END
  FROM public.order_line_economics
  WHERE order_date >= ((p_date::timestamp)       AT TIME ZONE 'Europe/London')
    AND order_date <  (((p_date + 1)::timestamp) AT TIME ZONE 'Europe/London');
$$;
GRANT EXECUTE ON FUNCTION public.get_profit_day(date) TO authenticated, anon, service_role;

-- Orin email delivery config (read by supabase/functions/orin-report).
INSERT INTO public.app_settings (key, value) VALUES
  ('orin.recipients',      '["clivejardine@me.com","clive@partsdoc.co.uk","robert@kashyyyk.co.uk"]'::jsonb),
  ('orin.email_cadences',  '["daily","weekly","monthly"]'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
