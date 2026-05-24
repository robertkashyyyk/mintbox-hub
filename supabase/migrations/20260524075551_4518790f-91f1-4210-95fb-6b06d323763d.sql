
CREATE TABLE IF NOT EXISTS public.stock_valuation_weekly_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iso_year int NOT NULL,
  iso_week int NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  total_skus bigint NOT NULL DEFAULT 0,
  total_units numeric NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  missing_cost_skus bigint NOT NULL DEFAULT 0,
  missing_cost_units numeric NOT NULL DEFAULT 0,
  remote_skus bigint NOT NULL DEFAULT 0,
  remote_units numeric NOT NULL DEFAULT 0,
  remote_value numeric NOT NULL DEFAULT 0,
  avg_value_per_sku numeric NOT NULL DEFAULT 0,
  by_category jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (iso_year, iso_week)
);

CREATE INDEX IF NOT EXISTS idx_svws_week ON public.stock_valuation_weekly_snapshots (iso_year DESC, iso_week DESC);

ALTER TABLE public.stock_valuation_weekly_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Senior+ can view stock valuation snapshots" ON public.stock_valuation_weekly_snapshots;
CREATE POLICY "Senior+ can view stock valuation snapshots"
  ON public.stock_valuation_weekly_snapshots
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_user'::app_role)
    OR public.has_role(auth.uid(), 'senior_user'::app_role)
  );

CREATE OR REPLACE FUNCTION public.snapshot_stock_valuation()
RETURNS public.stock_valuation_weekly_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary record;
  v_year int;
  v_week int;
  v_week_start date;
  v_week_end date;
  v_row public.stock_valuation_weekly_snapshots;
BEGIN
  SELECT * INTO v_summary FROM public.get_stock_valuation_summary(NULL, false, true);

  v_year := EXTRACT(ISOYEAR FROM now())::int;
  v_week := EXTRACT(WEEK FROM now())::int;
  v_week_start := (date_trunc('week', now()))::date;
  v_week_end   := (v_week_start + INTERVAL '6 days')::date;

  INSERT INTO public.stock_valuation_weekly_snapshots (
    iso_year, iso_week, week_start, week_end,
    total_skus, total_units, total_value,
    missing_cost_skus, missing_cost_units,
    remote_skus, remote_units, remote_value,
    avg_value_per_sku, by_category, captured_at
  ) VALUES (
    v_year, v_week, v_week_start, v_week_end,
    COALESCE(v_summary.total_skus, 0),
    COALESCE(v_summary.total_units, 0),
    COALESCE(v_summary.total_value, 0),
    COALESCE(v_summary.missing_cost_skus, 0),
    COALESCE(v_summary.missing_cost_units, 0),
    COALESCE(v_summary.remote_skus, 0),
    COALESCE(v_summary.remote_units, 0),
    COALESCE(v_summary.remote_value, 0),
    CASE WHEN COALESCE(v_summary.total_skus, 0) > 0
         THEN COALESCE(v_summary.total_value, 0) / v_summary.total_skus
         ELSE 0 END,
    COALESCE(v_summary.by_category, '{}'::jsonb),
    now()
  )
  ON CONFLICT (iso_year, iso_week) DO UPDATE
  SET week_start = EXCLUDED.week_start,
      week_end = EXCLUDED.week_end,
      total_skus = EXCLUDED.total_skus,
      total_units = EXCLUDED.total_units,
      total_value = EXCLUDED.total_value,
      missing_cost_skus = EXCLUDED.missing_cost_skus,
      missing_cost_units = EXCLUDED.missing_cost_units,
      remote_skus = EXCLUDED.remote_skus,
      remote_units = EXCLUDED.remote_units,
      remote_value = EXCLUDED.remote_value,
      avg_value_per_sku = EXCLUDED.avg_value_per_sku,
      by_category = EXCLUDED.by_category,
      captured_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_stock_valuation() TO authenticated;
