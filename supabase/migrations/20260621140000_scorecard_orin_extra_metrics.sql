-- Extend get_scorecard (Orin's only data surface + the /intelligence/scorecard page) with
-- the metrics the team asked Orin to narrate with real numbers:
--   • Repricing payoff   — SKUs repriced + recovered £ (reprice_payoff_daily, latest snapshot/week)
--   • SKUs given a cost   — weekly count of products_cache cost_price set (the missing-cost push)
--   • Profit-tier mix     — loss/break-even line count + healthy-margin share (get_profit_band_history)
-- Same return shape; new areas 'reprice' and 'profit_mix' (UI AREA_ORDER updated alongside).
-- get_profit_band_history() scans order_line_economics (~0.7s) so scorecard ~1s — acceptable.

-- RAG config for the new metrics (merge into existing scorecard.rag).
UPDATE public.app_settings
SET value = value || '{
  "loss_lines":{"good":"down","amber":10,"red":25},
  "healthy_share_pct":{"good":"up","amber":5,"red":15},
  "reprice_recovered_gbp":{"good":"up","amber":10,"red":25}
}'::jsonb
WHERE key = 'scorecard.rag';

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
    -- ── REPRICING PAYOFF (latest daily snapshot within each ISO week) ──
    UNION ALL
    SELECT 'reprice','reprice_recovered_gbp','Repricing recovered £','gbp', z.psort, z.plabel, z.value::numeric
    FROM (SELECT EXTRACT(ISOYEAR FROM snapshot_date)::int*100+EXTRACT(WEEK FROM snapshot_date)::int psort,
                 EXTRACT(ISOYEAR FROM snapshot_date)::int||'-W'||lpad(EXTRACT(WEEK FROM snapshot_date)::int::text,2,'0') plabel,
                 value,
                 row_number() OVER (PARTITION BY EXTRACT(ISOYEAR FROM snapshot_date), EXTRACT(WEEK FROM snapshot_date)
                                    ORDER BY snapshot_date DESC) rn
          FROM reprice_payoff_daily) z
    WHERE z.rn = 1
    UNION ALL
    SELECT 'reprice','reprice_skus','SKUs repriced','count', z.psort, z.plabel, z.repriced_skus::numeric
    FROM (SELECT EXTRACT(ISOYEAR FROM snapshot_date)::int*100+EXTRACT(WEEK FROM snapshot_date)::int psort,
                 EXTRACT(ISOYEAR FROM snapshot_date)::int||'-W'||lpad(EXTRACT(WEEK FROM snapshot_date)::int::text,2,'0') plabel,
                 repriced_skus,
                 row_number() OVER (PARTITION BY EXTRACT(ISOYEAR FROM snapshot_date), EXTRACT(WEEK FROM snapshot_date)
                                    ORDER BY snapshot_date DESC) rn
          FROM reprice_payoff_daily) z
    WHERE z.rn = 1
    -- NOTE: a "SKUs costed this week" metric off products_cache.cost_price_updated_at was
    -- dropped — it's dominated by one-off bulk cost re-syncs (a single historical week had
    -- ~104k updates) and reads as a misleading "current week". The true missing-cost
    -- remediation signal is the week-over-week DROP in missing_cost_skus (already a metric
    -- above), which Orin's prompt already narrates as the weekly change once snapshots accrue.
    -- ── PROFIT-TIER MIX (live from get_profit_band_history) ──
    UNION ALL
    SELECT 'profit_mix','loss_lines','Loss / break-even lines','count',
           iso_year*100+iso_week, iso_year||'-W'||lpad(iso_week::text,2,'0'),
           (loss_count + breakeven_count)::numeric
    FROM get_profit_band_history()
    UNION ALL
    SELECT 'profit_mix','healthy_share_pct','Healthy-margin share','pct',
           iso_year*100+iso_week, iso_year||'-W'||lpad(iso_week::text,2,'0'),
           round((100.0*(good_count+great_count+amazing_count)
             / NULLIF(loss_count+breakeven_count+poor_count+average_count+good_count+great_count+amazing_count,0))::numeric, 1)
    FROM get_profit_band_history()
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
