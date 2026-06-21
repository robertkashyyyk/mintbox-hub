-- PartsDocHub revenue/gross/orders TARGETS (Primary / Stretch / Ultimate), per the
-- scorecard-banding spec §2. Daily cells, regenerable for any year from a config model
-- (shares stored as config, NOT hard-coded, so they can be re-fitted as more years land).
--
-- Lane note: these are the PartsDocHub (Hub-fulfilled / "FBM") targets. Amazon FBA is a
-- separate future lane (SP-API not live) — handled by the pace engine, not here.
--
-- VERIFY after applying (must match spec §8 March): primary 364055 / stretch 452270 / ultimate 616980
--   SELECT goal, ROUND(SUM(target_value)) FROM scorecard_targets
--   WHERE metric='revenue' AND EXTRACT(MONTH FROM target_date)=3 AND EXTRACT(YEAR FROM target_date)=2026
--   GROUP BY goal;

-- Target model (config — edit here + re-run regenerate_scorecard_targets to re-fit).
INSERT INTO public.app_settings (key, value) VALUES (
  'scorecard.target_model',
  '{
    "goals": {
      "primary":  {"annual": 4000600, "margin": 0.275},
      "stretch":  {"annual": 4970000, "margin": 0.30},
      "ultimate": {"annual": 6780000, "margin": 0.35}
    },
    "month_share": [0.088,0.078,0.091,0.087,0.087,0.085,0.079,0.071,0.090,0.089,0.083,0.072],
    "dow_weight":  [0.168,0.164,0.154,0.144,0.137,0.113,0.120],
    "aov":         [18.96,20.13,19.96,20.07,19.89,16.93,16.01]
  }'::jsonb
) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE TABLE IF NOT EXISTS public.scorecard_targets (
  target_date  date    NOT NULL,
  goal         text    NOT NULL CHECK (goal IN ('primary','stretch','ultimate')),
  metric       text    NOT NULL CHECK (metric IN ('revenue','gross','orders')),
  target_value numeric NOT NULL,
  PRIMARY KEY (target_date, goal, metric)
);
ALTER TABLE public.scorecard_targets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY scorecard_targets_read ON public.scorecard_targets FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON public.scorecard_targets TO authenticated, service_role;

-- Regenerate all daily target cells for a year from the config model.
-- Allocation (spec §2): month_target = annual × month_share[m]; each date gets
-- month_target × dow_weight[wd] / Σ(dow_weight over that month's dates). Sums to annual.
CREATE OR REPLACE FUNCTION public.regenerate_scorecard_targets(p_year int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE m jsonb;
BEGIN
  SELECT value INTO m FROM app_settings WHERE key = 'scorecard.target_model';
  IF m IS NULL THEN RAISE EXCEPTION 'scorecard.target_model not set'; END IF;

  DELETE FROM scorecard_targets WHERE EXTRACT(YEAR FROM target_date)::int = p_year;

  INSERT INTO scorecard_targets (target_date, goal, metric, target_value)
  WITH days AS (
    SELECT d::date AS dt,
           EXTRACT(MONTH  FROM d)::int AS mon,
           EXTRACT(ISODOW FROM d)::int AS dow      -- 1=Mon … 7=Sun
    FROM generate_series(make_date(p_year,1,1), make_date(p_year,12,31), interval '1 day') d
  ),
  daily AS (
    SELECT dt, mon, dow,
           (m->'dow_weight'->>(dow-1))::numeric  AS doww,
           (m->'aov'->>(dow-1))::numeric         AS aov_d,
           (m->'month_share'->>(mon-1))::numeric AS share
    FROM days
  ),
  monthsum AS (SELECT mon, SUM(doww) AS sdow FROM daily GROUP BY mon),
  goals AS (
    SELECT g.key AS goal,
           (g.value->>'annual')::numeric AS annual,
           (g.value->>'margin')::numeric AS margin
    FROM jsonb_each(m->'goals') g
  ),
  cells AS (
    SELECT d.dt, g.goal, g.margin, d.aov_d,
           (g.annual * d.share * d.doww / ms.sdow) AS rev
    FROM daily d
    JOIN monthsum ms ON ms.mon = d.mon
    CROSS JOIN goals g
  )
  SELECT dt, goal, 'revenue', rev          FROM cells
  UNION ALL SELECT dt, goal, 'gross',  rev * margin  FROM cells
  UNION ALL SELECT dt, goal, 'orders', rev / NULLIF(aov_d,0) FROM cells;
END $$;
GRANT EXECUTE ON FUNCTION public.regenerate_scorecard_targets(int) TO service_role;

SELECT public.regenerate_scorecard_targets(2026);
