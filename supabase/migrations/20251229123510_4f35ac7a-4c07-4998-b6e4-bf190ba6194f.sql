-- Create order_status_snapshots table for twice-daily order count captures
CREATE TABLE public.order_status_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at timestamptz NOT NULL DEFAULT now(),
  capture_date_uk date NOT NULL,
  slot text NOT NULL CHECK (slot IN ('AM', 'PM')),
  new_count integer NOT NULL DEFAULT 0,
  onbackorder_count integer NOT NULL DEFAULT 0,
  awaitingpicking_count integer NOT NULL DEFAULT 0,
  picked_count integer NOT NULL DEFAULT 0,
  run_ok boolean NOT NULL DEFAULT true,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Uniqueness constraint to prevent double inserts on same date+slot
  UNIQUE (capture_date_uk, slot)
);

-- Indexes for efficient queries
CREATE INDEX idx_snapshots_captured_at ON public.order_status_snapshots (captured_at DESC);
CREATE INDEX idx_snapshots_date_slot ON public.order_status_snapshots (capture_date_uk DESC, slot);

-- Enable RLS
ALTER TABLE public.order_status_snapshots ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view snapshots
CREATE POLICY "Authenticated users can view snapshots"
  ON public.order_status_snapshots
  FOR SELECT
  USING (true);

-- Service role / edge functions can insert snapshots (no auth check for inserts via service role)
CREATE POLICY "Service role can insert snapshots"
  ON public.order_status_snapshots
  FOR INSERT
  WITH CHECK (true);

-- Optional: Create mintsoft_status_cache table for caching status IDs
CREATE TABLE public.mintsoft_status_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_name text UNIQUE NOT NULL,
  status_id integer NOT NULL,
  cached_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on cache table
ALTER TABLE public.mintsoft_status_cache ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view cache
CREATE POLICY "Authenticated users can view status cache"
  ON public.mintsoft_status_cache
  FOR SELECT
  USING (true);

-- Allow service role to manage cache
CREATE POLICY "Service role can manage status cache"
  ON public.mintsoft_status_cache
  FOR ALL
  WITH CHECK (true);

-- Create view for today's snapshots with deltas (UK timezone aware)
CREATE OR REPLACE VIEW public.order_status_snapshot_today AS
WITH uk_today AS (
  SELECT (now() AT TIME ZONE 'Europe/London')::date AS today_uk
),
today_am AS (
  SELECT s.* 
  FROM public.order_status_snapshots s, uk_today t
  WHERE s.capture_date_uk = t.today_uk AND s.slot = 'AM' AND s.run_ok = true
),
today_pm AS (
  SELECT s.* 
  FROM public.order_status_snapshots s, uk_today t
  WHERE s.capture_date_uk = t.today_uk AND s.slot = 'PM' AND s.run_ok = true
)
SELECT 
  t.today_uk as date_uk,
  am.captured_at as am_captured_at,
  am.new_count as am_new,
  am.onbackorder_count as am_onbackorder,
  am.awaitingpicking_count as am_awaitingpicking,
  am.picked_count as am_picked,
  pm.captured_at as pm_captured_at,
  pm.new_count as pm_new,
  pm.onbackorder_count as pm_onbackorder,
  pm.awaitingpicking_count as pm_awaitingpicking,
  pm.picked_count as pm_picked,
  -- Deltas (PM - AM)
  COALESCE(pm.new_count, 0) - COALESCE(am.new_count, 0) as delta_new,
  COALESCE(pm.onbackorder_count, 0) - COALESCE(am.onbackorder_count, 0) as delta_onbackorder,
  COALESCE(pm.awaitingpicking_count, 0) - COALESCE(am.awaitingpicking_count, 0) as delta_awaitingpicking,
  COALESCE(pm.picked_count, 0) - COALESCE(am.picked_count, 0) as delta_picked
FROM uk_today t
LEFT JOIN today_am am ON true
LEFT JOIN today_pm pm ON true;

-- Also create a view for latest snapshots (any date) for historical reference
CREATE OR REPLACE VIEW public.order_status_snapshot_latest AS
WITH latest_am AS (
  SELECT * FROM public.order_status_snapshots 
  WHERE slot = 'AM' AND run_ok = true
  ORDER BY captured_at DESC LIMIT 1
),
latest_pm AS (
  SELECT * FROM public.order_status_snapshots 
  WHERE slot = 'PM' AND run_ok = true
  ORDER BY captured_at DESC LIMIT 1
)
SELECT 
  'AM' as slot,
  am.capture_date_uk,
  am.captured_at,
  am.new_count,
  am.onbackorder_count,
  am.awaitingpicking_count,
  am.picked_count
FROM latest_am am
UNION ALL
SELECT 
  'PM' as slot,
  pm.capture_date_uk,
  pm.captured_at,
  pm.new_count,
  pm.onbackorder_count,
  pm.awaitingpicking_count,
  pm.picked_count
FROM latest_pm pm;