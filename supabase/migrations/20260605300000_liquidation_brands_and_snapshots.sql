-- Liquidation: per-brand rollup + weekly trend snapshots.

-- ── Per-brand aggregation (candidates + capital + dead + under-clearance) ──
CREATE OR REPLACE FUNCTION public.get_liquidation_by_brand(
  max_velocity numeric DEFAULT 0.5,
  min_capital  numeric DEFAULT 25
)
RETURNS TABLE(brand_name text, total_candidates bigint, capital_tied numeric, dead_count bigint, capital_under_clearance numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH cand AS (
    SELECT COALESCE(b.name, '(no brand)') AS brand_name, pc.sku, pc.current_stock, pc.cost_price,
      NOT EXISTS (SELECT 1 FROM order_lines ol WHERE ol.sku = pc.sku) AS is_dead
    FROM products_cache pc LEFT JOIN brands b ON b.id = pc.brand_id
    WHERE COALESCE(pc.discontinued,false)=false AND COALESCE(pc.quarantined,false)=false
      AND pc.current_stock>0 AND pc.cost_price>0
      AND COALESCE(pc.velocity_per_week,0)<=max_velocity
      AND (pc.current_stock*pc.cost_price)>=min_capital
      AND NOT EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku=pc.sku AND c.status='active')
      AND NOT EXISTS (SELECT 1 FROM liquidation_exclusions x WHERE x.sku=pc.sku)
  ),
  cand_agg AS (
    SELECT brand_name, count(*)::bigint tot, round(sum(current_stock*cost_price),2) cap,
           count(*) FILTER (WHERE is_dead)::bigint dead
    FROM cand GROUP BY brand_name
  ),
  clr AS (
    SELECT COALESCE(b.name,'(no brand)') AS brand_name, round(sum(pcmp.baseline_stock*pcmp.baseline_cost),2) cap
    FROM price_campaigns pcmp
    JOIN products_cache pc ON pc.sku = pcmp.sku
    LEFT JOIN brands b ON b.id = pc.brand_id
    WHERE pcmp.status='active'
    GROUP BY 1
  )
  SELECT COALESCE(ca.brand_name, clr.brand_name) AS brand_name,
    COALESCE(ca.tot,0), COALESCE(ca.cap,0), COALESCE(ca.dead,0), COALESCE(clr.cap,0)
  FROM cand_agg ca FULL OUTER JOIN clr ON ca.brand_name = clr.brand_name
  ORDER BY COALESCE(ca.cap,0) DESC;
$$;

-- ── Weekly trend snapshots ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.liquidation_snapshots (
  snapshot_date date PRIMARY KEY,
  total_candidates bigint,
  total_capital numeric,
  dead_count bigint,
  capital_under_clearance numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.liquidation_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read liq_snap" ON public.liquidation_snapshots FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.capture_liquidation_snapshot()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  INSERT INTO public.liquidation_snapshots (snapshot_date, total_candidates, total_capital, dead_count, capital_under_clearance)
  SELECT current_date, t.total, t.total_capital, t.dead_count, c.capital_under_clearance
  FROM get_liquidation_candidate_count(0.5, 25, NULL) t, get_clearance_capital() c
  ON CONFLICT (snapshot_date) DO UPDATE
    SET total_candidates = EXCLUDED.total_candidates,
        total_capital = EXCLUDED.total_capital,
        dead_count = EXCLUDED.dead_count,
        capital_under_clearance = EXCLUDED.capital_under_clearance;
$$;

-- Sunday 20:00 UTC weekly snapshot
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('liquidation-weekly-snapshot') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='liquidation-weekly-snapshot');
    PERFORM cron.schedule('liquidation-weekly-snapshot', '0 20 * * 0', 'SELECT capture_liquidation_snapshot()');
  END IF;
END $$;

-- Seed one snapshot now so the graph isn't empty
SELECT public.capture_liquidation_snapshot();
