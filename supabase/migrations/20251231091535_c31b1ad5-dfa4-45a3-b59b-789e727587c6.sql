-- Create ops_report_subscribers table
CREATE TABLE public.ops_report_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  report_type TEXT NOT NULL DEFAULT 'weekly',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on ops_report_subscribers
ALTER TABLE public.ops_report_subscribers ENABLE ROW LEVEL SECURITY;

-- Only super_user can manage subscribers
CREATE POLICY "Super users can manage subscribers"
ON public.ops_report_subscribers FOR ALL
USING (has_role(auth.uid(), 'super_user'::app_role));

-- Create ops_report_log table
CREATE TABLE public.ops_report_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL DEFAULT 'weekly',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recipients_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  week_ending DATE
);

-- Enable RLS on ops_report_log
ALTER TABLE public.ops_report_log ENABLE ROW LEVEL SECURITY;

-- Super users can view logs
CREATE POLICY "Super users can view report logs"
ON public.ops_report_log FOR SELECT
USING (has_role(auth.uid(), 'super_user'::app_role));

-- Service role can insert logs
CREATE POLICY "Service role can insert report logs"
ON public.ops_report_log FOR INSERT
WITH CHECK (true);

-- Create ops_backorder_daily_delta view
CREATE OR REPLACE VIEW public.ops_backorder_daily_delta AS
WITH today AS (
  SELECT * FROM backorder_age_snapshot 
  WHERE capture_date_uk = CURRENT_DATE
  ORDER BY created_at DESC
  LIMIT 1
),
yesterday AS (
  SELECT * FROM backorder_age_snapshot 
  WHERE capture_date_uk = CURRENT_DATE - INTERVAL '1 day'
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT 
  t.capture_date_uk,
  t.total_onbackorder,
  t.bo_rotten_30_plus,
  t.bo_serious_14_29,
  t.bo_urgent_7_13,
  t.bo_pressure_2_6,
  t.bo_fresh_0_1,
  t.created_at,
  (t.total_onbackorder - COALESCE(y.total_onbackorder, 0)) AS delta_total,
  (t.bo_rotten_30_plus - COALESCE(y.bo_rotten_30_plus, 0)) AS delta_rotten,
  (t.bo_serious_14_29 - COALESCE(y.bo_serious_14_29, 0)) AS delta_serious,
  (t.bo_urgent_7_13 - COALESCE(y.bo_urgent_7_13, 0)) AS delta_urgent,
  (t.bo_pressure_2_6 - COALESCE(y.bo_pressure_2_6, 0)) AS delta_pressure,
  (t.bo_fresh_0_1 - COALESCE(y.bo_fresh_0_1, 0)) AS delta_fresh
FROM today t
LEFT JOIN yesterday y ON true;

-- Create ops_backorder_weekly_summary view
CREATE OR REPLACE VIEW public.ops_backorder_weekly_summary AS
WITH date_range AS (
  SELECT 
    MIN(capture_date_uk) AS week_start,
    MAX(capture_date_uk) AS week_end
  FROM backorder_age_snapshot
  WHERE capture_date_uk >= CURRENT_DATE - INTERVAL '7 days'
),
current_snapshot AS (
  SELECT total_onbackorder, bo_rotten_30_plus, bo_serious_14_29, bo_urgent_7_13
  FROM backorder_age_snapshot 
  ORDER BY capture_date_uk DESC, created_at DESC 
  LIMIT 1
),
week_start_snapshot AS (
  SELECT total_onbackorder, bo_rotten_30_plus, bo_serious_14_29, bo_urgent_7_13
  FROM backorder_age_snapshot 
  WHERE capture_date_uk >= CURRENT_DATE - INTERVAL '7 days'
  ORDER BY capture_date_uk ASC, created_at ASC 
  LIMIT 1
)
SELECT 
  dr.week_start,
  dr.week_end,
  c.total_onbackorder AS current_total,
  c.bo_rotten_30_plus AS current_rotten,
  c.bo_serious_14_29 AS current_serious,
  c.bo_urgent_7_13 AS current_urgent,
  ws.total_onbackorder AS week_start_total,
  ws.bo_rotten_30_plus AS week_start_rotten,
  ws.bo_serious_14_29 AS week_start_serious,
  ws.bo_urgent_7_13 AS week_start_urgent,
  (c.total_onbackorder - COALESCE(ws.total_onbackorder, 0)) AS net_change
FROM date_range dr
CROSS JOIN current_snapshot c
CROSS JOIN week_start_snapshot ws;

-- Create ops_exceptions_today view
CREATE OR REPLACE VIEW public.ops_exceptions_today AS
WITH today_bo AS (
  SELECT * FROM backorder_age_snapshot 
  WHERE capture_date_uk = CURRENT_DATE 
  ORDER BY created_at DESC
  LIMIT 1
),
yesterday_bo AS (
  SELECT * FROM backorder_age_snapshot 
  WHERE capture_date_uk = CURRENT_DATE - INTERVAL '1 day'
  ORDER BY created_at DESC
  LIMIT 1
),
today_orders AS (
  SELECT * FROM order_status_snapshot_today 
  LIMIT 1
),
trend_3day AS (
  SELECT capture_date_uk, total_onbackorder,
    LAG(total_onbackorder) OVER (ORDER BY capture_date_uk) AS prev_total
  FROM (
    SELECT DISTINCT ON (capture_date_uk) capture_date_uk, total_onbackorder
    FROM backorder_age_snapshot
    WHERE capture_date_uk >= CURRENT_DATE - INTERVAL '3 days'
    ORDER BY capture_date_uk, created_at DESC
  ) daily
)
SELECT
  COALESCE(t.bo_rotten_30_plus > COALESCE(y.bo_rotten_30_plus, 0), false) AS rotten_increased,
  COALESCE(t.bo_serious_14_29 > COALESCE(y.bo_serious_14_29, 0), false) AS serious_increased,
  COALESCE(o.pm_awaitingpicking IS NOT NULL AND o.pm_awaitingpicking >= COALESCE(o.am_awaitingpicking, 0), false) AS picking_not_cleared,
  COALESCE(
    (SELECT COUNT(*) FROM trend_3day WHERE total_onbackorder >= COALESCE(prev_total, 0)) >= 2,
    false
  ) AS backorders_rising_trend
FROM today_bo t
LEFT JOIN yesterday_bo y ON true
LEFT JOIN today_orders o ON true;