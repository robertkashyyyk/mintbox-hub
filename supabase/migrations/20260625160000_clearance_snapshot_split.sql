-- ============================================================================
-- Clearance — record the On Sale vs In Liquidation split in the weekly snapshot
-- so the Clearance report's trend can show two lines (not just the combined
-- "under clearance"). History from older rows stays combined; the split builds
-- from now. Reuses get_clearance_breakdown() (Build 1).
-- ============================================================================
ALTER TABLE public.liquidation_snapshots
  ADD COLUMN IF NOT EXISTS on_sale_capital     numeric,
  ADD COLUMN IF NOT EXISTS liquidation_capital numeric;

CREATE OR REPLACE FUNCTION public.capture_liquidation_snapshot()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  INSERT INTO public.liquidation_snapshots (
    snapshot_date, total_candidates, total_capital, dead_count,
    capital_under_clearance, on_sale_capital, liquidation_capital)
  SELECT current_date, t.total, t.total_capital, t.dead_count,
         b.on_sale_capital + b.liquidation_capital, b.on_sale_capital, b.liquidation_capital
  FROM get_liquidation_candidate_count(0.5, 25, NULL) t, get_clearance_breakdown() b
  ON CONFLICT (snapshot_date) DO UPDATE
    SET total_candidates        = EXCLUDED.total_candidates,
        total_capital           = EXCLUDED.total_capital,
        dead_count              = EXCLUDED.dead_count,
        capital_under_clearance = EXCLUDED.capital_under_clearance,
        on_sale_capital         = EXCLUDED.on_sale_capital,
        liquidation_capital     = EXCLUDED.liquidation_capital;
$$;

-- Capture one now so today's split is in immediately.
SELECT public.capture_liquidation_snapshot();
