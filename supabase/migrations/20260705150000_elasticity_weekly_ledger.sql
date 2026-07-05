-- Elasticity experimentation foundation: a weekly per-SKU-per-channel snapshot of
-- price / units / profit. Backfilled from order_line_economics (W1..now) so baselines exist
-- immediately; a daily job tops up recent weeks. Forward price experiments (via the reprice
-- queue) then populate the demand CURVE. Tuning params live in app_settings (soft-coded, no
-- redeploy) — mirrors lsa.* / profit.*.

CREATE TABLE IF NOT EXISTS public.elasticity_weekly (
  sku         text    NOT NULL,
  channel     text    NOT NULL,
  iso_year    int     NOT NULL,
  iso_week    int     NOT NULL,
  week_start  date,
  units       numeric NOT NULL DEFAULT 0,
  revenue     numeric NOT NULL DEFAULT 0,   -- ex-VAT
  profit      numeric NOT NULL DEFAULT 0,
  avg_cost    numeric,
  avg_price   numeric,                        -- ex-VAT unit price = revenue/units
  on_campaign boolean DEFAULT false,
  PRIMARY KEY (sku, channel, iso_year, iso_week)
);
CREATE INDEX IF NOT EXISTS idx_elasticity_weekly_sku ON public.elasticity_weekly(sku);
GRANT SELECT ON public.elasticity_weekly TO authenticated, service_role;

INSERT INTO public.app_settings (key, value, description) VALUES
  ('elasticity.min_units_per_week', '4'::jsonb,    'Only experiment on SKUs selling at least this many units/week.'),
  ('elasticity.step_pct',           '0.025'::jsonb,'Price nudge per experiment step (fraction). Guide; rounded to the .95 ladder.'),
  ('elasticity.round_to',           '0.95'::jsonb, 'Price ladder — round proposed prices to this ending.'),
  ('elasticity.max_drift_pct',      '0.30'::jsonb, 'Max cumulative move from baseline before a step forces human review.'),
  ('elasticity.hold_policy',        '{"units":10,"weeks":2}'::jsonb, 'Judge a price step after this many units OR weeks, whichever first.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.refresh_elasticity_weekly()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO elasticity_weekly (sku, channel, iso_year, iso_week, week_start, units, revenue, profit, avg_cost, avg_price)
  SELECT ole.sku, ole.channel, ole.iso_year, ole.iso_week, MIN(ole.week_start),
         SUM(ole.qty), ROUND(SUM(ole.order_value),2), ROUND(SUM(ole.profit),2),
         ROUND(SUM(ole.cost_each*ole.qty)/NULLIF(SUM(ole.qty),0),4),
         ROUND(SUM(ole.order_value)/NULLIF(SUM(ole.qty),0),4)
  FROM order_line_economics ole
  WHERE ole.sku IS NOT NULL AND ole.channel IS NOT NULL
    AND ole.order_date >= now() - interval '21 days'
  GROUP BY ole.sku, ole.channel, ole.iso_year, ole.iso_week
  ON CONFLICT (sku, channel, iso_year, iso_week) DO UPDATE
    SET week_start=excluded.week_start, units=excluded.units, revenue=excluded.revenue,
        profit=excluded.profit, avg_cost=excluded.avg_cost, avg_price=excluded.avg_price;
$$;
REVOKE ALL ON FUNCTION public.refresh_elasticity_weekly() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_elasticity_weekly() TO service_role;

-- One-time full backfill of all history.
INSERT INTO public.elasticity_weekly (sku, channel, iso_year, iso_week, week_start, units, revenue, profit, avg_cost, avg_price)
SELECT ole.sku, ole.channel, ole.iso_year, ole.iso_week, MIN(ole.week_start),
       SUM(ole.qty), ROUND(SUM(ole.order_value),2), ROUND(SUM(ole.profit),2),
       ROUND(SUM(ole.cost_each*ole.qty)/NULLIF(SUM(ole.qty),0),4),
       ROUND(SUM(ole.order_value)/NULLIF(SUM(ole.qty),0),4)
FROM public.order_line_economics ole
WHERE ole.sku IS NOT NULL AND ole.channel IS NOT NULL
GROUP BY ole.sku, ole.channel, ole.iso_year, ole.iso_week
ON CONFLICT (sku, channel, iso_year, iso_week) DO NOTHING;

SELECT cron.schedule('refresh-elasticity-weekly', '20 4 * * *', 'SELECT public.refresh_elasticity_weekly()');
