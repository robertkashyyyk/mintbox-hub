-- ============================================================================
-- 20260630320000_channel_history_and_settlement_recon.sql
-- C: get_profit_history_by_channel() — per (week, channel) revenue/profit/POR for
--    the "profit by channel over time" chart. From order_economics_all, W12 floor.
-- E: amazon_settlement_recon(start, end) — our AFN Principal/referral/FBA-fee totals
--    for a posted-date window, to reconcile against a Seller Central settlement.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_profit_history_by_channel()
RETURNS TABLE(
  iso_year integer, iso_week integer, week_start date, channel text,
  revenue numeric, profit numeric, por_pct numeric, qty bigint, orders bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ole.iso_year, ole.iso_week, MIN(ole.week_start),
    COALESCE(ole.channel, '—') AS channel,
    COALESCE(SUM(ole.order_value), 0),
    COALESCE(SUM(ole.profit), 0),
    CASE WHEN SUM(ole.order_value * 1.2) > 0
      THEN ROUND((SUM(ole.profit) / SUM(ole.order_value * 1.2))::numeric, 6) ELSE NULL END,
    COALESCE(SUM(ole.qty), 0)::bigint,
    COUNT(DISTINCT ole.mintsoft_order_id)::bigint
  FROM public.order_economics_all ole
  WHERE ole.week_start >= '2026-03-16'::date
  GROUP BY ole.iso_year, ole.iso_week, COALESCE(ole.channel, '—')
  ORDER BY ole.iso_year, ole.iso_week, channel;
$$;
GRANT EXECUTE ON FUNCTION public.get_profit_history_by_channel() TO anon, authenticated, service_role;

-- Reconcile our ingested FBA economics against a Seller Central settlement window.
-- Sums our AFN shipment events by posted-date; compare to the settlement's AFN totals.
CREATE OR REPLACE FUNCTION public.amazon_settlement_recon(p_start date, p_end date)
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public, amazon
AS $$
  WITH afn AS (
    SELECT DISTINCT amazon_order_id FROM amazon.orders
    WHERE upper(COALESCE(fulfillment_channel, '')) IN ('AMAZON', 'AFN')
  ),
  fe AS (
    SELECT event_subtype, direction, original_amount, amazon_order_id
    FROM amazon.financial_events
    WHERE event_type = 'Shipment'
      AND posted_date::date BETWEEN p_start AND p_end
      AND amazon_order_id IN (SELECT amazon_order_id FROM afn)
  )
  SELECT jsonb_build_object(
    'window_start', p_start, 'window_end', p_end,
    'principal',  COALESCE(SUM(original_amount) FILTER (WHERE event_subtype='Principal' AND direction='credit'), 0),
    'commission', COALESCE(SUM(original_amount) FILTER (WHERE event_subtype='Commission'), 0),
    'fba_fee',    COALESCE(SUM(original_amount) FILTER (WHERE event_subtype='FBAPerUnitFulfillmentFee'), 0),
    'afn_orders', COUNT(DISTINCT amazon_order_id)
  ) FROM fe;
$$;
REVOKE ALL ON FUNCTION public.amazon_settlement_recon(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_settlement_recon(date, date) TO authenticated, service_role;
