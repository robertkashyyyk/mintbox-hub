-- Daily stock snapshot — the keystone data asset.
--
-- Everything stock-related today is "now" only (products_cache holds current state).
-- This logs a daily point-in-time row per *relevant* SKU (in stock, on order, on
-- backorder, or selling) so we can finally answer over-time questions:
--   * availability-adjusted velocity (don't write down a SKU that was simply OOS)
--   * Strangled Sellers (sold, went OOS, never reordered, demand decayed)
--   * stockout cost / days-out-of-stock, cover & capital trends
--
-- Lean by design: ~10k relevant SKUs/day (not the full 225k catalogue). Cost is
-- snapshotted too, so historical capital values stay accurate. 400-day retention.

CREATE TABLE IF NOT EXISTS public.stock_snapshot (
  snapshot_date date    NOT NULL,
  sku           text    NOT NULL,
  on_hand       numeric,
  on_order      numeric,
  back_order    numeric,
  lsa           numeric,   -- low_stock_alert_level at snapshot time
  cost_price    numeric,
  brand_id      uuid,
  PRIMARY KEY (snapshot_date, sku)
);

CREATE INDEX IF NOT EXISTS idx_stock_snapshot_sku  ON public.stock_snapshot (sku, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_stock_snapshot_date ON public.stock_snapshot (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_stock_snapshot_brand ON public.stock_snapshot (brand_id);

ALTER TABLE public.stock_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_snapshot read" ON public.stock_snapshot;
CREATE POLICY "stock_snapshot read" ON public.stock_snapshot FOR SELECT USING (true);

-- Capture today's snapshot (idempotent — re-running the same day updates the row),
-- then prune anything older than 400 days.
CREATE OR REPLACE FUNCTION public.capture_stock_snapshot()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_n integer;
BEGIN
  INSERT INTO public.stock_snapshot
    (snapshot_date, sku, on_hand, on_order, back_order, lsa, cost_price, brand_id)
  SELECT v_today, p.sku,
    COALESCE(p.current_stock, 0),
    COALESCE(p.on_order_qty, p.on_order, 0),
    COALESCE(p.back_order_qty, 0),
    p.low_stock_alert_level,
    p.cost_price,
    p.brand_id
  FROM public.products_cache p
  WHERE COALESCE(p.current_stock, 0) > 0
     OR COALESCE(p.on_order_qty, p.on_order, 0) > 0
     OR COALESCE(p.back_order_qty, 0) > 0
     OR EXISTS (SELECT 1 FROM public.sku_velocity v WHERE v.sku = p.sku AND v.avg_weekly_units > 0)
  ON CONFLICT (snapshot_date, sku) DO UPDATE SET
    on_hand = EXCLUDED.on_hand, on_order = EXCLUDED.on_order, back_order = EXCLUDED.back_order,
    lsa = EXCLUDED.lsa, cost_price = EXCLUDED.cost_price, brand_id = EXCLUDED.brand_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM public.stock_snapshot WHERE snapshot_date < v_today - 400;
  RETURN v_n;
END;
$function$;

GRANT SELECT ON public.stock_snapshot TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_stock_snapshot() TO anon, authenticated, service_role;

-- Nightly at 22:30 UTC (end of trading day, after the day's despatch/sync settles).
-- Idempotent: replaces the job by name. Adjust the time if the stock sync lands later.
SELECT cron.schedule(
  'capture-stock-snapshot-daily',
  '30 22 * * *',
  $$SELECT public.capture_stock_snapshot();$$
);

-- Seed today's snapshot immediately so the series starts now.
SELECT public.capture_stock_snapshot();
