-- Scorecard + Orin · Track A spine (build spec v1)
-- ONE source of truth: get_scorecard() computes each metric once from the existing
-- retained snapshots; Orin reads get_scorecard() outputs and narrates — never recomputes.
-- Read-only AI tier: Orin writes ONLY to ai_reports, nothing operational.
-- Track A scope: profit/P&L, 80-20 concentration, stock valuation, missing-cost.
-- Excluded by design (no clean single-sourced history yet): dispatch, velocity,
-- stock accuracy, returns.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. RAG config (tunable, not hard-coded) — read by get_scorecard so tiles and
--    Orin can never disagree. good = direction that is "good"; amber/red are the
--    ADVERSE period-over-period % thresholds. neutral = inform only (rag 'none').
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'scorecard.rag',
  '{
     "profit_gbp":          {"good":"up",      "amber":5,  "red":15},
     "por_pct":             {"good":"up",      "amber":5,  "red":15},
     "revenue_gbp":         {"good":"up",      "amber":8,  "red":20},
     "top20_profit_share":  {"good":"neutral"},
     "total_value_gbp":     {"good":"neutral"},
     "dead_stock_value_gbp":{"good":"down",    "amber":5,  "red":15},
     "missing_cost_skus":   {"good":"down",    "amber":2,  "red":10}
   }'::jsonb,
  'Scorecard RAG thresholds: per metric good-direction + adverse % bands (amber/red).'
)
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Missing-cost retained series (Pattern A). The headline "63k / 28%" count has
--    no existing retained history, so capture it weekly into its own keyed table.
--    Full-catalog cost null/<=0 to match the cited figure; active = excl. dead.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scorecard_missing_cost_weekly (
  iso_year           integer     NOT NULL,
  iso_week           integer     NOT NULL,
  captured_at        timestamptz NOT NULL DEFAULT now(),
  missing_cost_skus  integer     NOT NULL,   -- full catalog: cost_price IS NULL OR <= 0
  active_missing     integer,                -- excl. discontinued/quarantined, mintsoft_id present
  total_skus         integer     NOT NULL,
  PRIMARY KEY (iso_year, iso_week)
);
ALTER TABLE public.scorecard_missing_cost_weekly ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY scorecard_missing_cost_read ON public.scorecard_missing_cost_weekly
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON public.scorecard_missing_cost_weekly TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.capture_scorecard_missing_cost()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  INSERT INTO public.scorecard_missing_cost_weekly
    (iso_year, iso_week, captured_at, missing_cost_skus, active_missing, total_skus)
  SELECT
    EXTRACT(ISOYEAR FROM now())::int,
    EXTRACT(WEEK    FROM now())::int,
    now(),
    COUNT(*) FILTER (WHERE cost_price IS NULL OR cost_price <= 0),
    COUNT(*) FILTER (WHERE (cost_price IS NULL OR cost_price <= 0)
                       AND COALESCE(discontinued,false)=false
                       AND COALESCE(quarantined,false)=false
                       AND mintsoft_id IS NOT NULL),
    COUNT(*)
  FROM public.products_cache
  ON CONFLICT (iso_year, iso_week) DO UPDATE
    SET missing_cost_skus = EXCLUDED.missing_cost_skus,
        active_missing    = EXCLUDED.active_missing,
        total_skus        = EXCLUDED.total_skus,
        captured_at       = EXCLUDED.captured_at;
$$;
GRANT EXECUTE ON FUNCTION public.capture_scorecard_missing_cost() TO service_role;

-- seed current week immediately so the metric has a value on day one
SELECT public.capture_scorecard_missing_cost();

-- weekly cron (Sun 23:00 UTC) — pure in-DB, no edge hop (Pattern A)
SELECT cron.unschedule('capture-scorecard-missing-cost-weekly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='capture-scorecard-missing-cost-weekly');
SELECT cron.schedule('capture-scorecard-missing-cost-weekly', '0 23 * * 0',
  $$ SELECT public.capture_scorecard_missing_cost(); $$);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. ai_reports — Orin's ONLY write target. Append-and-keep so monthly can
--    reference prior periods. Nothing operational is ever written by Orin.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cadence        text NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
  period_key     text NOT NULL,            -- e.g. '2026-W24' or '2026-06-16'
  scope          text NOT NULL DEFAULT 'track_a',
  generated_at   timestamptz NOT NULL DEFAULT now(),
  model          text,
  input_snapshot jsonb,                    -- the get_scorecard() rows it narrated
  narrative      text,
  status         text NOT NULL DEFAULT 'complete',
  error_message  text
);
CREATE INDEX IF NOT EXISTS ai_reports_cadence_generated_idx
  ON public.ai_reports (cadence, generated_at DESC);
ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY ai_reports_read ON public.ai_reports
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- writes are service-role only (the Orin function); no UPDATE/DELETE policy = none for authenticated
GRANT SELECT ON public.ai_reports TO authenticated;
GRANT SELECT, INSERT ON public.ai_reports TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. get_scorecard() — THE single read surface. Reads existing retained snapshots,
--    shapes each metric into current vs prior + a small series + RAG. Computed once.
--    p_lookback_weeks bounds the series (Orin's "direction of travel" context).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_scorecard(p_lookback_weeks integer DEFAULT 8)
RETURNS TABLE(
  area               text,
  metric_key         text,
  label              text,
  unit               text,            -- 'gbp' | 'pct' | 'count'
  good_direction     text,            -- 'up' | 'down' | 'neutral'
  period_label       text,            -- latest period, e.g. '2026-W24'
  current_value      numeric,
  prior_value        numeric,
  delta              numeric,
  delta_pct          numeric,
  direction          text,            -- 'up' | 'down' | 'flat'
  periods_available  integer,
  rag                text,            -- 'green' | 'amber' | 'red' | 'none'
  series             jsonb            -- [{period, value}] oldest→newest, last p_lookback_weeks
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH cfg AS (
    SELECT COALESCE((SELECT value FROM app_settings WHERE key='scorecard.rag'), '{}'::jsonb) AS rag
  ),
  -- one tidy long table: (area, metric_key, label, unit, psort, plabel, value)
  raw AS (
    -- ── PROFIT / P&L (profit_weekly_snapshots) ──
    SELECT 'profit'::text area, 'profit_gbp'::text metric_key, 'Weekly profit'::text label, 'gbp'::text unit,
           (iso_year*100+iso_week) psort, (iso_year||'-W'||lpad(iso_week::text,2,'0')) plabel, profit::numeric value
    FROM profit_weekly_snapshots
    UNION ALL
    SELECT 'profit','por_pct','Profit-on-return %','pct',
           iso_year*100+iso_week, iso_year||'-W'||lpad(iso_week::text,2,'0'), round((por_pct*100)::numeric,2)
    FROM profit_weekly_snapshots
    UNION ALL
    SELECT 'profit','revenue_gbp','Weekly revenue','gbp',
           iso_year*100+iso_week, iso_year||'-W'||lpad(iso_week::text,2,'0'), revenue::numeric
    FROM profit_weekly_snapshots
    -- ── 80-20 CONCENTRATION (profit_8020_weekly): profit share of top 20% of SKUs ──
    UNION ALL
    SELECT 'eighty_twenty','top20_profit_share','Profit from top 20% of SKUs','pct',
           psort, plabel,
           round((100.0 * SUM(profit) FILTER (WHERE pr <= 0.20) / NULLIF(SUM(profit),0))::numeric, 1)
    FROM (
      SELECT iso_year*100+iso_week psort, iso_year||'-W'||lpad(iso_week::text,2,'0') plabel, profit,
             percent_rank() OVER (PARTITION BY iso_year, iso_week ORDER BY profit DESC) pr
      FROM profit_8020_weekly WHERE profit > 0
    ) r GROUP BY psort, plabel
    -- ── STOCK VALUATION (stock_valuation_weekly_snapshots) ──
    UNION ALL
    SELECT 'stock_valuation','total_value_gbp','Total stock value','gbp',
           iso_year*100+iso_week, iso_year||'-W'||lpad(iso_week::text,2,'0'), total_value::numeric
    FROM stock_valuation_weekly_snapshots
    UNION ALL
    SELECT 'stock_valuation','dead_stock_value_gbp','Dead-stock value','gbp',
           iso_year*100+iso_week, iso_year||'-W'||lpad(iso_week::text,2,'0'),
           COALESCE((by_category->'Dead Stock'->>'value')::numeric, 0)
    FROM stock_valuation_weekly_snapshots
    -- ── MISSING-COST data quality (scorecard_missing_cost_weekly) ──
    UNION ALL
    SELECT 'missing_cost','missing_cost_skus','SKUs with no cost','count',
           iso_year*100+iso_week, iso_year||'-W'||lpad(iso_week::text,2,'0'), missing_cost_skus::numeric
    FROM scorecard_missing_cost_weekly
  ),
  ranked AS (
    SELECT raw.*,
           row_number() OVER (PARTITION BY metric_key ORDER BY psort DESC) AS rn,
           count(*)     OVER (PARTITION BY metric_key)                     AS n
    FROM raw
  ),
  agg AS (
    SELECT
      metric_key,
      max(area)  area, max(label) label, max(unit) unit,
      max(value) FILTER (WHERE rn=1) cur,
      max(value) FILTER (WHERE rn=2) prv,
      max(plabel) FILTER (WHERE rn=1) plabel,
      max(n) n,
      jsonb_agg(jsonb_build_object('period', plabel, 'value', value) ORDER BY psort)
        FILTER (WHERE rn <= p_lookback_weeks) series
    FROM ranked GROUP BY metric_key
  )
  SELECT
    a.area, a.metric_key, a.label, a.unit,
    COALESCE(cfg.rag->a.metric_key->>'good','neutral') AS good_direction,
    a.plabel,
    a.cur, a.prv,
    (a.cur - a.prv) AS delta,
    CASE WHEN a.prv IS NULL OR a.prv = 0 THEN NULL
         ELSE round((100.0*(a.cur-a.prv)/abs(a.prv))::numeric, 1) END AS delta_pct,
    CASE WHEN a.prv IS NULL THEN 'flat'
         WHEN a.cur > a.prv THEN 'up' WHEN a.cur < a.prv THEN 'down' ELSE 'flat' END AS direction,
    a.n AS periods_available,
    CASE
      WHEN a.prv IS NULL OR a.n < 2
        OR COALESCE(cfg.rag->a.metric_key->>'good','neutral')='neutral' THEN 'none'
      WHEN (CASE WHEN (cfg.rag->a.metric_key->>'good')='up' THEN -1 ELSE 1 END)
           * (100.0*(a.cur-a.prv)/abs(NULLIF(a.prv,0)))
           > (cfg.rag->a.metric_key->>'red')::numeric   THEN 'red'
      WHEN (CASE WHEN (cfg.rag->a.metric_key->>'good')='up' THEN -1 ELSE 1 END)
           * (100.0*(a.cur-a.prv)/abs(NULLIF(a.prv,0)))
           > (cfg.rag->a.metric_key->>'amber')::numeric THEN 'amber'
      ELSE 'green'
    END AS rag,
    a.series
  FROM agg a CROSS JOIN cfg
  ORDER BY a.area, a.metric_key;
$$;
GRANT EXECUTE ON FUNCTION public.get_scorecard(integer) TO authenticated, service_role;
