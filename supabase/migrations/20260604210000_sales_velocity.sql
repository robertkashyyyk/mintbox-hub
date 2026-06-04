-- ============================================================
-- Sales velocity on products_cache (weekly refresh)
-- ------------------------------------------------------------
-- Aggregates order_lines (every sales line since 2026-01-01) into
-- per-SKU units-sold + a units/week velocity, refreshed every Sunday
-- via pg_cron. Pure in-database — no Mintsoft, no edge function.
-- Used to prioritise work (e.g. Web Searcher batches: top sellers first).
-- ============================================================

-- 1. Columns ---------------------------------------------------
ALTER TABLE public.products_cache
  ADD COLUMN IF NOT EXISTS units_sold_30d      integer,
  ADD COLUMN IF NOT EXISTS units_sold_90d      integer,
  ADD COLUMN IF NOT EXISTS velocity_per_week   numeric,
  ADD COLUMN IF NOT EXISTS velocity_updated_at timestamptz;

-- Speeds up the aggregate
CREATE INDEX IF NOT EXISTS idx_order_lines_sku_date ON public.order_lines(sku, order_date);
-- Helps "top sellers first" ordering
CREATE INDEX IF NOT EXISTS idx_products_cache_velocity ON public.products_cache(velocity_per_week DESC NULLS LAST);

-- 2. Refresh function -----------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_sales_velocity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- aggregate last 90 days of demand per SKU
  CREATE TEMP TABLE _vel ON COMMIT DROP AS
    SELECT
      sku,
      COALESCE(SUM(qty) FILTER (WHERE order_date::timestamptz >= now() - interval '30 days'), 0) AS u30,
      COALESCE(SUM(qty) FILTER (WHERE order_date::timestamptz >= now() - interval '90 days'), 0) AS u90
    FROM public.order_lines
    WHERE order_date::timestamptz >= now() - interval '90 days'
    GROUP BY sku;

  -- write velocities for SKUs that sold
  UPDATE public.products_cache pc
  SET units_sold_30d      = v.u30,
      units_sold_90d      = v.u90,
      velocity_per_week   = ROUND(v.u90 / (90.0 / 7.0), 2),
      velocity_updated_at = now()
  FROM _vel v
  WHERE pc.sku = v.sku;

  -- clear SKUs that previously had velocity but no longer sell (avoid stale data)
  UPDATE public.products_cache pc
  SET units_sold_30d      = 0,
      units_sold_90d      = 0,
      velocity_per_week   = 0,
      velocity_updated_at = now()
  WHERE COALESCE(pc.velocity_per_week, 0) > 0
    AND NOT EXISTS (SELECT 1 FROM _vel v WHERE v.sku = pc.sku);
END;
$$;

-- 3. Run it once now to populate ------------------------------
SELECT public.refresh_sales_velocity();

-- 4. Schedule weekly — Sundays 02:00 --------------------------
SELECT cron.unschedule('refresh-sales-velocity-weekly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-sales-velocity-weekly');

SELECT cron.schedule(
  'refresh-sales-velocity-weekly',
  '0 2 * * 0',
  $$ SELECT public.refresh_sales_velocity(); $$
);
