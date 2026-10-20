-- 20261020120000_targets_restatement_postage_inclusive_exvat_fees.sql
--
-- Restate the Orin / War Room daily targets like-for-like onto the SAME basis the
-- Orin cards and narrative already use: postage-inclusive revenue & profit, with
-- channel fees counted EX-VAT (fees became ex-VAT in the 29-Sep-2026 fee-VAT rebase,
-- which also restated the actuals history).
--
-- Two coordinated changes:
--   1. Target MARGINS recalibrated so difficulty is unchanged but measured correctly:
--        Primary 27.5% -> 30.1%,  Stretch 30.0% -> 32.6%,  Ultimate 35.0% -> 37.6%.
--      Annual REVENUE goals are UNCHANGED (even though revenue actuals now include
--      customer-paid postage — that uplift is intentionally absorbed into the margin
--      recalibration, so the revenue line stays the same number people already track).
--      scorecard_targets is regenerated for the WHOLE of 2026 so MTD / quarter / YTD
--      pace compares like-for-like against the historically-restated actuals.
--   2. get_target_pace actuals switched from order_line_economics UNION
--      v_fba_order_economics (product-only, pre-rebase basis) to a single scan of
--      order_economics_all using order_value_incl_postage / profit_incl_postage.
--      order_economics_all == order_line_economics (non-FBA) UNION v_fba_order_economics
--      exactly, so the population is identical and each order is counted once; the
--      _incl_postage columns equal the base columns for Amazon/FBA (no customer postage)
--      and exceed them for eBay (postage credit net of the fee on postage).
--
-- The old target model is preserved in scorecard_target_model_history (effective_to
-- today) alongside the new one (effective_from today), plus an audit_log row.

BEGIN;

-- 1. Effective-dated history of the scorecard target model, for traceability.
CREATE TABLE IF NOT EXISTS public.scorecard_target_model_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model          jsonb NOT NULL,
  effective_from date,
  effective_to   date,
  note           text,
  recorded_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.scorecard_target_model_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read scorecard_target_model_history"
  ON public.scorecard_target_model_history;
CREATE POLICY "auth read scorecard_target_model_history"
  ON public.scorecard_target_model_history FOR SELECT TO authenticated USING (true);

-- 2. Capture old model, apply new margins, record history + audit, regenerate 2026.
DO $mig$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  SELECT value INTO v_old FROM public.app_settings
   WHERE key = 'scorecard.target_model' FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'scorecard.target_model not set';
  END IF;

  -- Guard: only restate if still on the old margins, so re-running is a no-op.
  IF (v_old->'goals'->'primary'->>'margin')::numeric = 0.301 THEN
    RAISE NOTICE 'targets already restated (primary margin = 0.301); skipping';
    RETURN;
  END IF;

  -- Old model -> history (effective_to = today).
  INSERT INTO public.scorecard_target_model_history (model, effective_from, effective_to, note)
  VALUES (
    v_old, NULL, DATE '2026-10-20',
    'Pre-restatement model. Margins 27.5/30.0/35.0 calibrated on product-only revenue '
    || 'with channel fees counted INC VAT (pre 29-Sep-2026 fee-VAT rebase). '
    || 'Superseded 20 Oct 2026.'
  );

  -- New model: new margins only; annual revenue goals unchanged.
  v_new := jsonb_set(v_old, '{goals}', jsonb_build_object(
    'primary',  jsonb_build_object('annual', (v_old->'goals'->'primary'->>'annual')::numeric,  'margin', 0.301),
    'stretch',  jsonb_build_object('annual', (v_old->'goals'->'stretch'->>'annual')::numeric,  'margin', 0.326),
    'ultimate', jsonb_build_object('annual', (v_old->'goals'->'ultimate'->>'annual')::numeric, 'margin', 0.376)
  ));

  UPDATE public.app_settings SET value = v_new WHERE key = 'scorecard.target_model';

  -- New model -> history (effective_from = today).
  INSERT INTO public.scorecard_target_model_history (model, effective_from, effective_to, note)
  VALUES (
    v_new, DATE '2026-10-20', NULL,
    'Restated model. Margins 30.1/32.6/37.6 recalibrated like-for-like onto the '
    || 'postage-inclusive, ex-VAT-fee basis (same difficulty, measured correctly). '
    || 'Annual REVENUE goals UNCHANGED despite revenue actuals now including '
    || 'customer-paid postage; the postage uplift is absorbed into the margin '
    || 'recalibration. get_target_pace switched to order_economics_all _incl_postage '
    || 'columns in the same migration.'
  );

  -- Audit row (mirrors set_target_goals; system actor as this runs as a migration).
  INSERT INTO public.audit_log
    (actor_user_id, actor_display_name, action_type, entity_type, entity_label, old_value, new_value)
  VALUES
    (NULL, 'migration 20261020 targets restatement', 'targets.goals_changed',
     'scorecard.target_model', 'War Room targets', v_old->'goals', v_new->'goals');

  -- Regenerate the full 2026 table from the new model.
  -- revenue & orders rows are identical (annual + seasonality + aov unchanged);
  -- only the gross rows change (= revenue * new margin).
  PERFORM public.regenerate_scorecard_targets(2026);
END
$mig$;

-- 3. get_target_pace on the postage-inclusive, single unified source.
CREATE OR REPLACE FUNCTION public.get_target_pace(p_grain text DEFAULT 'mtd'::text, p_asof date DEFAULT ((now() AT TIME ZONE 'Europe/London'::text))::date)
 RETURNS TABLE(grain text, period_label text, metric text, actual numeric, exp_primary numeric, exp_stretch numeric, exp_ultimate numeric, tier text, tier_label text, nearest_line text, variance_vs_primary_pct numeric, variance_abs numeric, volatile boolean, partial_cost boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '20s'
AS $function$
  WITH params AS (
    SELECT p_grain AS grain, p_asof AS asof, 0.025::numeric AS b,
      CASE p_grain
        WHEN 'day'     THEN p_asof
        WHEN 'week'    THEN p_asof - 6
        WHEN 'mtd'     THEN date_trunc('month',   p_asof)::date
        WHEN 'quarter' THEN GREATEST(date_trunc('quarter', p_asof)::date, DATE '2026-03-16')
        WHEN 'ytd'     THEN GREATEST(date_trunc('year', p_asof)::date, DATE '2026-03-16')
        ELSE date_trunc('month', p_asof)::date
      END AS start
  ),
  -- Postage-inclusive, ex-VAT-fee actuals from the unified economics view.
  -- order_economics_all == order_line_economics (non-FBA) UNION v_fba_order_economics,
  -- so every channel is counted once; _incl_postage == base for Amazon/FBA (no customer
  -- postage) and > base for eBay. This is the SAME basis as the Orin cards/narrative.
  src AS (
    SELECT oea.order_value_incl_postage AS order_value,
           oea.mintsoft_order_id,
           oea.profit_incl_postage      AS profit,
           oea.missing_cost
    FROM order_economics_all oea, params p
    WHERE oea.order_date >= (p.start::timestamp      AT TIME ZONE 'Europe/London')
      AND oea.order_date <  ((p.asof + 1)::timestamp AT TIME ZONE 'Europe/London')
  ),
  act AS (
    SELECT
      COALESCE(SUM(order_value), 0)::numeric        AS revenue,
      COUNT(DISTINCT mintsoft_order_id)::numeric    AS orders,
      COALESCE(SUM(profit), 0)::numeric             AS gross,
      COALESCE(bool_or(missing_cost), false)        AS partial_cost
    FROM src
  ),
  exp AS (
    SELECT st.metric,
      SUM(st.target_value) FILTER (WHERE st.goal='primary')  AS p,
      SUM(st.target_value) FILTER (WHERE st.goal='stretch')  AS s,
      SUM(st.target_value) FILTER (WHERE st.goal='ultimate') AS u
    FROM scorecard_targets st, params pr
    WHERE st.target_date BETWEEN pr.start AND pr.asof
    GROUP BY st.metric
  ),
  rows AS (
    SELECT m.metric,
      CASE m.metric WHEN 'revenue' THEN act.revenue WHEN 'gross' THEN act.gross ELSE act.orders END AS actual,
      e.p, e.s, e.u, act.partial_cost
    FROM (VALUES ('revenue'),('gross'),('orders')) m(metric)
    CROSS JOIN act
    LEFT JOIN exp e ON e.metric = m.metric
  )
  SELECT
    pr.grain,
    CASE pr.grain
      WHEN 'day'     THEN to_char(pr.asof,'DD Mon')
      WHEN 'week'    THEN '7 days to '||to_char(pr.asof,'DD Mon')
      WHEN 'mtd'     THEN to_char(pr.asof,'Mon')||' MTD'
      WHEN 'quarter' THEN 'Q'||to_char(pr.asof,'Q')||' to date'
      WHEN 'ytd'     THEN 'YTD (from 16 Mar)'
      ELSE pr.grain END AS period_label,
    r.metric, r.actual, r.p, r.s, r.u,
    CASE WHEN pr.grain='day' OR r.p IS NULL THEN NULL
      WHEN r.actual <  r.p*(1-pr.b) THEN 'below_primary'
      WHEN r.actual <= r.p*(1+pr.b) THEN 'on_primary'
      WHEN r.actual <  r.s*(1-pr.b) THEN 'firmly_primary'
      WHEN r.actual <= r.s*(1+pr.b) THEN 'on_stretch'
      WHEN r.actual <  r.u*(1-pr.b) THEN 'firmly_stretch'
      WHEN r.actual <= r.u*(1+pr.b) THEN 'on_ultimate'
      ELSE 'above_ultimate' END AS tier,
    CASE WHEN pr.grain='day' OR r.p IS NULL THEN NULL
      WHEN r.actual <  r.p*(1-pr.b) THEN 'Behind Primary pace'
      WHEN r.actual <= r.p*(1+pr.b) THEN 'Primary met, on the line'
      WHEN r.actual <  r.s*(1-pr.b) THEN 'Primary secured, building toward Stretch'
      WHEN r.actual <= r.s*(1+pr.b) THEN 'Stretch met'
      WHEN r.actual <  r.u*(1-pr.b) THEN 'Stretch secured, building toward Ultimate'
      WHEN r.actual <= r.u*(1+pr.b) THEN 'Ultimate met'
      ELSE 'Beyond Ultimate' END AS tier_label,
    CASE WHEN r.p IS NULL THEN NULL
      WHEN r.actual >= r.u THEN 'ultimate'
      WHEN r.actual >= r.s THEN 'stretch'
      ELSE 'primary' END AS nearest_line,
    CASE WHEN r.p IS NULL OR r.p = 0 THEN NULL ELSE ROUND(((r.actual - r.p)/r.p)::numeric, 4) END AS variance_vs_primary_pct,
    CASE WHEN r.p IS NULL THEN NULL ELSE ROUND((r.actual - r.p)::numeric, 2) END AS variance_abs,
    (pr.grain = 'day') AS volatile,
    (r.metric = 'gross' AND r.partial_cost) AS partial_cost
  FROM rows r CROSS JOIN params pr;
$function$;

COMMIT;
