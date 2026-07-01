-- get_work_completed — the "what we actively did to the data" feed for Orin.
--
-- Orin's trading numbers say WHAT happened; this says what the TEAM DID about it —
-- the data-hygiene / operational graft the user wants credited in the reports:
-- missing costs amended, dirt-SKU work, LSA recalibration, POs raised, repricing
-- coverage, and the remaining FBA unmapped backlog.
--
-- Sources (all read-only, SECURITY DEFINER so it bypasses RLS like get_scorecard):
--   activity_log        — the human work log (cost updates, LSA applies, PO creates)
--   threeds_sku_aliases — dirt-SKU alias work (no created_at; uses updated_at as the touch clock)
--   reprice_payoff_daily— repricing coverage (running SKU count)
--   v_fba_unmapped      — remaining FBA ASINs to tie up (per-period tie-ups are NOT logged yet)
--
-- Window is [p_from, p_to] inclusive, Europe/London. Returns one jsonb blob that
-- orin-report drops straight into the prompt. Orin narrates it, never recomputes it.

CREATE OR REPLACE FUNCTION public.get_work_completed(
  p_from date DEFAULT (now() AT TIME ZONE 'Europe/London')::date - 6,
  p_to   date DEFAULT (now() AT TIME ZONE 'Europe/London')::date
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH bounds AS (
    SELECT (p_from::timestamp        AT TIME ZONE 'Europe/London') AS lo,
           ((p_to + 1)::timestamp     AT TIME ZONE 'Europe/London') AS hi
  ),
  al AS (
    SELECT action, detail
    FROM activity_log, bounds
    WHERE created_at >= bounds.lo AND created_at < bounds.hi
  ),
  costs AS (
    SELECT
      COUNT(*) FILTER (WHERE action = 'product.cost_update')                                            AS single_cost,
      COUNT(*) FILTER (WHERE action = 'product.cost_bulk_update')                                       AS bulk_runs,
      COALESCE(SUM((detail->>'updated')::int) FILTER (WHERE action = 'product.cost_bulk_update'), 0)     AS bulk_cost
    FROM al
  ),
  lsa AS (
    SELECT
      COUNT(*) FILTER (WHERE action = 'lsa_calibration.bulk_apply')                                     AS runs,
      COALESCE(SUM((detail->>'updated')::int) FILTER (WHERE action = 'lsa_calibration.bulk_apply'), 0)   AS skus
    FROM al
  ),
  po AS (
    SELECT
      COUNT(*) FILTER (WHERE action = 'purchase_order.create')                                          AS cnt,
      COALESCE(SUM((detail->>'lines')::int)     FILTER (WHERE action = 'purchase_order.create'), 0)      AS lines,
      COALESCE(SUM((detail->>'total_cost')::numeric) FILTER (WHERE action = 'purchase_order.create'), 0) AS value
    FROM al
  ),
  -- Dirt-SKU aliases have no created_at and a bulk refresh stamps updated_at on every row,
  -- so a windowed count would misreport a single backfill as N "resolutions". Report the
  -- CUMULATIVE crosswalk size instead (honest coverage), not a per-window count.
  dirt AS (
    SELECT COUNT(*) AS coverage FROM threeds_sku_aliases
  ),
  fba AS (
    SELECT COUNT(*) AS n_rows, COUNT(DISTINCT asin) AS asins FROM v_fba_unmapped
  ),
  reprice AS (
    SELECT repriced_skus FROM reprice_payoff_daily ORDER BY snapshot_date DESC LIMIT 1
  )
  SELECT jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to, 'days', (p_to - p_from) + 1),
    'costs_amended',       (SELECT single_cost + bulk_cost FROM costs),
    'costs_detail',        (SELECT jsonb_build_object('individual', single_cost, 'bulk_runs', bulk_runs, 'bulk_skus', bulk_cost) FROM costs),
    'lsa_recalibrated',    (SELECT jsonb_build_object('runs', runs, 'skus', skus) FROM lsa),
    'purchase_orders',     (SELECT jsonb_build_object('count', cnt, 'lines', lines, 'value_gbp', ROUND(value, 2)) FROM po),
    'dirt_alias_coverage', (SELECT coverage FROM dirt),
    'reprice_coverage_skus', (SELECT repriced_skus FROM reprice),
    'fba_unmapped_backlog',  (SELECT jsonb_build_object('rows', n_rows, 'asins', asins,
                                'note', 'remaining ASINs to tie up; per-period tie-ups not yet logged') FROM fba)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_work_completed(date, date) TO authenticated, anon, service_role;
