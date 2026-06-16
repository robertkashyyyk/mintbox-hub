-- Track B1 — dispatch onto the scorecard, on the canonical (label-printed) clock.
-- Ratified definition: "dispatched" = order marked despatched in Mintsoft (label printed
-- / bagged) — exactly what despatch_ledger.despatched_at holds (Mintsoft DespatchDate).
-- Ledger-preferred v_despatch_events is canonical; ledger is accurate from ~2026-06-15
-- (poll-despatched-today fixed), so dispatch history starts there.
--
-- Why a retained daily table: v_despatch_events re-scans all order_status_history every
-- call (why the perf fns time out). Precompute per-day from the ledger (cheap, indexed),
-- read that. Same definition as get_despatch_performance, sourced from the ledger.

-- Speeds the v_despatch_events history backstop branch (used pre-15-Jun / elsewhere).
CREATE INDEX IF NOT EXISTS idx_osh_despatched_order
  ON public.order_status_history (mintsoft_order_id)
  WHERE to_status = 'DESPATCHED';

-- Retained daily dispatch performance (append-and-keep; one row per UK day).
CREATE TABLE IF NOT EXISTS public.dispatch_performance_daily (
  uk_date          date PRIMARY KEY,
  total_despatched integer NOT NULL DEFAULT 0,
  within_24h       integer NOT NULL DEFAULT 0,
  within_48h       integer NOT NULL DEFAULT 0,
  within_72h       integer NOT NULL DEFAULT 0,
  captured_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dispatch_performance_daily ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY dispatch_perf_daily_read ON public.dispatch_performance_daily
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON public.dispatch_performance_daily TO authenticated, anon, service_role;

-- Capture one UK day from the LEDGER (authoritative from 15-Jun). Mirrors the hours
-- logic of get_despatch_performance: time-to-despatch = despatched_at - order placement.
CREATE OR REPLACE FUNCTION public.capture_dispatch_performance(p_date date)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH ev AS (
    SELECT mintsoft_order_id, MIN(despatched_at) AS despatched_at
    FROM public.despatch_ledger WHERE uk_date = p_date GROUP BY mintsoft_order_id
  ),
  order_origin AS (
    SELECT mintsoft_order_id, MIN(COALESCE(order_date, first_seen_at)) AS placed_at
    FROM public.order_lines
    WHERE mintsoft_order_id IN (SELECT mintsoft_order_id FROM ev)
      AND order_date >= '2026-01-01'::timestamptz
    GROUP BY mintsoft_order_id
  ),
  paired AS (
    SELECT EXTRACT(EPOCH FROM (ev.despatched_at - o.placed_at))/3600 AS hours
    FROM ev JOIN order_origin o USING (mintsoft_order_id)
    WHERE o.placed_at IS NOT NULL AND ev.despatched_at >= o.placed_at
  )
  INSERT INTO public.dispatch_performance_daily
    (uk_date, total_despatched, within_24h, within_48h, within_72h, captured_at)
  SELECT p_date,
         count(*),
         count(*) FILTER (WHERE hours <= 24),
         count(*) FILTER (WHERE hours <= 48),
         count(*) FILTER (WHERE hours <= 72),
         now()
  FROM paired
  ON CONFLICT (uk_date) DO UPDATE
    SET total_despatched = EXCLUDED.total_despatched,
        within_24h = EXCLUDED.within_24h,
        within_48h = EXCLUDED.within_48h,
        within_72h = EXCLUDED.within_72h,
        captured_at = EXCLUDED.captured_at;
$$;
GRANT EXECUTE ON FUNCTION public.capture_dispatch_performance(date) TO service_role;

-- Daily wrapper: re-capture the last 3 days (today is partial; yesterday finalises).
CREATE OR REPLACE FUNCTION public.capture_dispatch_performance_recent()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE d date;
BEGIN
  FOR d IN SELECT generate_series((now() AT TIME ZONE 'Europe/London')::date - 2,
                                  (now() AT TIME ZONE 'Europe/London')::date, interval '1 day')::date
  LOOP PERFORM public.capture_dispatch_performance(d); END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.capture_dispatch_performance_recent() TO service_role;

-- Backfill from the ratified accurate start (15-Jun) to today.
DO $$
DECLARE d date;
BEGIN
  FOR d IN SELECT generate_series('2026-06-15'::date,
                                  (now() AT TIME ZONE 'Europe/London')::date, interval '1 day')::date
  LOOP PERFORM public.capture_dispatch_performance(d); END LOOP;
END $$;

-- Daily cron (23:00 UTC) — Pattern A, pure in-DB.
SELECT cron.unschedule('capture-dispatch-performance-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='capture-dispatch-performance-daily');
SELECT cron.schedule('capture-dispatch-performance-daily', '0 23 * * *',
  $$ SELECT public.capture_dispatch_performance_recent(); $$);

-- Add dispatch RAG config (higher % = better; merge into existing config).
UPDATE public.app_settings
SET value = value || '{"despatch_24h_pct":{"good":"up","amber":5,"red":15},
                      "despatch_48h_pct":{"good":"up","amber":5,"red":15}}'::jsonb
WHERE key = 'scorecard.rag';

-- ── Extend get_scorecard with dispatch (weekly % from dispatch_performance_daily) ──
-- Same return shape; adds the 'dispatch' area. UI/Orin don't surface it until B3.
CREATE OR REPLACE FUNCTION public.get_scorecard(p_lookback_weeks integer DEFAULT 8)
RETURNS TABLE(
  area text, metric_key text, label text, unit text, good_direction text,
  period_label text, current_value numeric, prior_value numeric, delta numeric,
  delta_pct numeric, direction text, periods_available integer, rag text, series jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH cfg AS (
    SELECT COALESCE((SELECT value FROM app_settings WHERE key='scorecard.rag'), '{}'::jsonb) AS rag
  ),
  raw AS (
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
    UNION ALL
    SELECT 'eighty_twenty','top20_profit_share','Profit from top 20% of SKUs','pct',
           psort, plabel,
           round((100.0 * SUM(profit) FILTER (WHERE pr <= 0.20) / NULLIF(SUM(profit),0))::numeric, 1)
    FROM (
      SELECT iso_year*100+iso_week psort, iso_year||'-W'||lpad(iso_week::text,2,'0') plabel, profit,
             percent_rank() OVER (PARTITION BY iso_year, iso_week ORDER BY profit DESC) pr
      FROM profit_8020_weekly WHERE profit > 0
    ) r GROUP BY psort, plabel
    UNION ALL
    SELECT 'stock_valuation','total_value_gbp','Total stock value','gbp',
           iso_year*100+iso_week, iso_year||'-W'||lpad(iso_week::text,2,'0'), total_value::numeric
    FROM stock_valuation_weekly_snapshots
    UNION ALL
    SELECT 'stock_valuation','dead_stock_value_gbp','Dead-stock value','gbp',
           iso_year*100+iso_week, iso_year||'-W'||lpad(iso_week::text,2,'0'),
           COALESCE((by_category->'Dead Stock'->>'value')::numeric, 0)
    FROM stock_valuation_weekly_snapshots
    UNION ALL
    SELECT 'missing_cost','missing_cost_skus','SKUs with no cost','count',
           iso_year*100+iso_week, iso_year||'-W'||lpad(iso_week::text,2,'0'), missing_cost_skus::numeric
    FROM scorecard_missing_cost_weekly
    -- ── DISPATCH (canonical, label-printed; weekly % from dispatch_performance_daily) ──
    UNION ALL
    SELECT 'dispatch','despatch_24h_pct','Despatched <24h','pct', psort, plabel,
           round((100.0*SUM(within_24h)/NULLIF(SUM(total_despatched),0))::numeric,1)
    FROM (SELECT EXTRACT(ISOYEAR FROM uk_date)::int*100+EXTRACT(WEEK FROM uk_date)::int psort,
                 EXTRACT(ISOYEAR FROM uk_date)::int||'-W'||lpad(EXTRACT(WEEK FROM uk_date)::int::text,2,'0') plabel,
                 within_24h, total_despatched FROM dispatch_performance_daily) dd
    GROUP BY psort, plabel
    UNION ALL
    SELECT 'dispatch','despatch_48h_pct','Despatched <48h','pct', psort, plabel,
           round((100.0*SUM(within_48h)/NULLIF(SUM(total_despatched),0))::numeric,1)
    FROM (SELECT EXTRACT(ISOYEAR FROM uk_date)::int*100+EXTRACT(WEEK FROM uk_date)::int psort,
                 EXTRACT(ISOYEAR FROM uk_date)::int||'-W'||lpad(EXTRACT(WEEK FROM uk_date)::int::text,2,'0') plabel,
                 within_48h, total_despatched FROM dispatch_performance_daily) dd
    GROUP BY psort, plabel
  ),
  ranked AS (
    SELECT raw.*,
           row_number() OVER (PARTITION BY metric_key ORDER BY psort DESC) AS rn,
           count(*)     OVER (PARTITION BY metric_key)                     AS n
    FROM raw
  ),
  agg AS (
    SELECT metric_key, max(area) area, max(label) label, max(unit) unit,
      max(value) FILTER (WHERE rn=1) cur, max(value) FILTER (WHERE rn=2) prv,
      max(plabel) FILTER (WHERE rn=1) plabel, max(n) n,
      jsonb_agg(jsonb_build_object('period', plabel, 'value', value) ORDER BY psort)
        FILTER (WHERE rn <= p_lookback_weeks) series
    FROM ranked GROUP BY metric_key
  )
  SELECT a.area, a.metric_key, a.label, a.unit,
    COALESCE(cfg.rag->a.metric_key->>'good','neutral') AS good_direction,
    a.plabel, a.cur, a.prv, (a.cur - a.prv) AS delta,
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
GRANT EXECUTE ON FUNCTION public.get_scorecard(integer) TO authenticated, anon, service_role;
