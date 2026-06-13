-- Daily snapshot log of the Repricing Payoff totals, so the Standing Report can
-- show the trend (recovered £ over time) and the figure can be seen to settle as
-- the actual sales rate fills in. Written nightly by the reprice-payoff edge fn
-- (persist mode); read by the report.

CREATE TABLE IF NOT EXISTS public.reprice_payoff_daily (
  snapshot_date date PRIMARY KEY,
  generated_at timestamptz NOT NULL DEFAULT now(),
  repriced_skus integer,
  actual_units integer,
  actual_profit numeric,
  cf_units numeric,
  cf_profit numeric,
  value numeric
);

ALTER TABLE public.reprice_payoff_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read reprice_payoff_daily" ON public.reprice_payoff_daily;
CREATE POLICY "auth read reprice_payoff_daily" ON public.reprice_payoff_daily
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service write reprice_payoff_daily" ON public.reprice_payoff_daily;
CREATE POLICY "service write reprice_payoff_daily" ON public.reprice_payoff_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);
