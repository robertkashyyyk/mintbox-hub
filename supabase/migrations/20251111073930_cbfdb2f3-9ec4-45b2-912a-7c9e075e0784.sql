-- Control table to track last successful pulls by dataset
CREATE TABLE IF NOT EXISTS public.ingest_run_state (
  id text PRIMARY KEY,              -- e.g. 'LowStock', 'Inventory'
  last_run_at timestamptz,          -- when we last pulled
  last_ok_at timestamptz,
  last_status text,
  updated_at timestamptz DEFAULT now()
);

-- Optional: API creds/settings (if stored in DB rather than env)
CREATE TABLE IF NOT EXISTS public.mintsoft_settings (
  id boolean PRIMARY KEY DEFAULT true,
  base_url text NOT NULL,
  api_key text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Add unique index to prevent duplicate entries in parsed_items
CREATE UNIQUE INDEX IF NOT EXISTS uniq_parsed_items_snapshot
ON public.parsed_items (report_type, occurred_at, sku, warehouse);

-- Enable RLS on new tables
ALTER TABLE public.ingest_run_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mintsoft_settings ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view ingest run state
CREATE POLICY "Authenticated users can view ingest run state"
ON public.ingest_run_state
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to view mintsoft settings
CREATE POLICY "Authenticated users can view mintsoft settings"
ON public.mintsoft_settings
FOR SELECT
TO authenticated
USING (true);