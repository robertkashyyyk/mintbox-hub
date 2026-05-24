
CREATE OR REPLACE FUNCTION public.snapshot_profit_week(p_iso_year int, p_iso_week int)
RETURNS public.profit_weekly_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  out_row public.profit_weekly_snapshots;
BEGIN
  SELECT * INTO r FROM public.get_profit_week(p_iso_year, p_iso_week);
  IF r IS NULL OR r.line_count IS NULL OR r.line_count = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.profit_weekly_snapshots (
    iso_year, iso_week, week_start, week_end,
    revenue, qty, order_count, line_count,
    courier_cost_total, channel_fees_total, cost_total,
    profit, por_pct, aov,
    aip, appp, appo,
    good_count, dirt_count, missing_cost_count,
    source, updated_at
  ) VALUES (
    p_iso_year, p_iso_week, r.week_start, r.week_end,
    r.revenue, r.qty::int, r.order_count::int, r.line_count::int,
    r.courier_cost_total, r.channel_fees_total, r.cost_total,
    r.profit, r.por_pct, r.aov,
    NULL, NULL, NULL,
    r.good_count::int, r.dirt_count::int, r.missing_cost_count::int,
    'backfill', now()
  )
  ON CONFLICT (iso_year, iso_week) DO UPDATE
  SET week_start = EXCLUDED.week_start,
      week_end = EXCLUDED.week_end,
      revenue = EXCLUDED.revenue,
      qty = EXCLUDED.qty,
      order_count = EXCLUDED.order_count,
      line_count = EXCLUDED.line_count,
      courier_cost_total = EXCLUDED.courier_cost_total,
      channel_fees_total = EXCLUDED.channel_fees_total,
      cost_total = EXCLUDED.cost_total,
      profit = EXCLUDED.profit,
      por_pct = EXCLUDED.por_pct,
      aov = EXCLUDED.aov,
      good_count = EXCLUDED.good_count,
      dirt_count = EXCLUDED.dirt_count,
      missing_cost_count = EXCLUDED.missing_cost_count,
      updated_at = now()
  RETURNING * INTO out_row;

  RETURN out_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_profit_weekly_snapshots()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
  n int := 0;
BEGIN
  FOR w IN
    SELECT DISTINCT iso_year, iso_week
    FROM public.order_line_economics
    ORDER BY iso_year, iso_week
  LOOP
    PERFORM public.snapshot_profit_week(w.iso_year, w.iso_week);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_profit_current_week()
RETURNS public.profit_weekly_snapshots
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.snapshot_profit_week(
    EXTRACT(ISOYEAR FROM now())::int,
    EXTRACT(WEEK    FROM now())::int
  );
$$;

GRANT EXECUTE ON FUNCTION public.snapshot_profit_week(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_profit_weekly_snapshots() TO authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_profit_current_week() TO authenticated;
