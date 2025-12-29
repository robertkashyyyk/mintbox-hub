-- Create backorder age snapshot table
CREATE TABLE backorder_age_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_date_uk date NOT NULL,
  total_onbackorder integer NOT NULL DEFAULT 0,
  bo_rotten_30_plus integer NOT NULL DEFAULT 0,
  bo_serious_14_29 integer NOT NULL DEFAULT 0,
  bo_urgent_7_13 integer NOT NULL DEFAULT 0,
  bo_pressure_2_6 integer NOT NULL DEFAULT 0,
  bo_fresh_0_1 integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (capture_date_uk)
);

-- Enable RLS
ALTER TABLE backorder_age_snapshot ENABLE ROW LEVEL SECURITY;

-- Authenticated users can SELECT
CREATE POLICY "Authenticated users can view backorder age snapshots"
ON backorder_age_snapshot FOR SELECT
TO authenticated
USING (true);

-- Service role can INSERT
CREATE POLICY "Service role can insert backorder age snapshots"
ON backorder_age_snapshot FOR INSERT
TO service_role
WITH CHECK (true);