-- Default thresholds (per-line £ profit)
INSERT INTO public.app_settings (key, value, description)
VALUES ('profit.loss_bands',
  '{"big_loss_max": -2.0, "small_loss_max": -0.5, "breakeven_max": 0.5, "small_profit_max": 2.0}'::jsonb,
  'Per-line profit £ thresholds for loss/profit segmentation on the Profit Intelligence dashboard.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_profit_week_breakdown(p_iso_year integer, p_iso_week integer)
RETURNS TABLE(
  band text,
  line_count bigint,
  pct numeric,
  profit_total numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH cfg AS (
    SELECT
      COALESCE((value->>'big_loss_max')::numeric, -2.0) AS big_loss_max,
      COALESCE((value->>'small_loss_max')::numeric, -0.5) AS small_loss_max,
      COALESCE((value->>'breakeven_max')::numeric, 0.5) AS breakeven_max,
      COALESCE((value->>'small_profit_max')::numeric, 2.0) AS small_profit_max
    FROM public.app_settings WHERE key = 'profit.loss_bands'
  ),
  src AS (
    SELECT profit FROM public.order_line_economics
    WHERE iso_year = p_iso_year AND iso_week = p_iso_week
      AND profit IS NOT NULL
  ),
  banded AS (
    SELECT
      CASE
        WHEN s.profit < c.big_loss_max THEN 'big_loss'
        WHEN s.profit < c.small_loss_max THEN 'small_loss'
        WHEN s.profit <= c.breakeven_max THEN 'breakeven'
        WHEN s.profit <= c.small_profit_max THEN 'small_profit'
        ELSE 'big_profit'
      END AS band,
      s.profit
    FROM src s, cfg c
  ),
  totals AS (SELECT COUNT(*)::bigint AS n FROM banded)
  SELECT
    b.band,
    COUNT(*)::bigint AS line_count,
    CASE WHEN t.n > 0 THEN ROUND((COUNT(*)::numeric / t.n) * 100, 2) ELSE 0 END AS pct,
    ROUND(SUM(b.profit)::numeric, 2) AS profit_total
  FROM banded b CROSS JOIN totals t
  GROUP BY b.band, t.n
  ORDER BY array_position(ARRAY['big_loss','small_loss','breakeven','small_profit','big_profit'], b.band);
$$;