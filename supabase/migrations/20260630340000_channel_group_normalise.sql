-- ============================================================================
-- 20260630340000_channel_group_normalise.sql
-- Normalise channel reporting: fold country/marketplace variants into a parent
-- (e.g. "Amazon - IE" -> "Amazon") so we don't end up with a card per country.
-- Keeps "Amazon FBA" separate (the fulfilment distinction we care about) and
-- leaves eBay storefronts as-is (they're stores, not countries).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.channel_group(p_channel text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_channel ILIKE 'Amazon FBA%' THEN 'Amazon FBA'
    WHEN p_channel ILIKE 'Amazon%'     THEN 'Amazon'
    ELSE COALESCE(NULLIF(p_channel, ''), '—')
  END;
$$;

-- Group the channel history by the normalised channel.
CREATE OR REPLACE FUNCTION public.get_profit_history_by_channel()
RETURNS TABLE(
  iso_year integer, iso_week integer, week_start date, channel text,
  revenue numeric, profit numeric, por_pct numeric, qty bigint, orders bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ole.iso_year, ole.iso_week, MIN(ole.week_start),
    public.channel_group(ole.channel) AS channel,
    COALESCE(SUM(ole.order_value), 0),
    COALESCE(SUM(ole.profit), 0),
    CASE WHEN SUM(ole.order_value * 1.2) > 0
      THEN ROUND((SUM(ole.profit) / SUM(ole.order_value * 1.2))::numeric, 6) ELSE NULL END,
    COALESCE(SUM(ole.qty), 0)::bigint,
    COUNT(DISTINCT ole.mintsoft_order_id)::bigint
  FROM public.order_economics_all ole
  WHERE ole.week_start >= '2026-03-16'::date
  GROUP BY ole.iso_year, ole.iso_week, public.channel_group(ole.channel)
  ORDER BY ole.iso_year, ole.iso_week, channel;
$$;
GRANT EXECUTE ON FUNCTION public.get_profit_history_by_channel() TO anon, authenticated, service_role;
