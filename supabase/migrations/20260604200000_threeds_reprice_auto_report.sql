-- Auto-Report mode for the 3D repricer.
--
-- A daily 8am snapshot (across ALL accounts) of the configured run — band = Loss,
-- move-to = Average, 30-day look-back — frozen as that day's review list. The
-- Auto-Report tab renders this snapshot; the user selects/removes and pushes,
-- which splits rows back to each account's file.
--
-- Settings live in app_settings under key 'reprice.auto_report' (a JSON blob),
-- editable from the main Settings page. The snapshot edge fn reads them.

-- 1. Default settings (only insert if absent — never clobber the user's config).
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'reprice.auto_report',
  jsonb_build_object(
    'enabled', true,
    'run_hour_london', 8,        -- 8am Europe/London (DST-aware in the edge fn)
    'lookback_days', 30,
    'current_band', 'loss',
    'move_to_tier', 'average'
  ),
  '3D Reprice Auto-Report: daily cross-account snapshot config'
)
ON CONFLICT (key) DO NOTHING;

-- 2. Daily snapshot rows — one per (date, store, sku). Mirrors the candidate RPC
--    output plus the owning account, so the tab renders without re-querying.
CREATE TABLE IF NOT EXISTS public.threeds_reprice_auto_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  store_id uuid NOT NULL REFERENCES public.threeds_stores(id) ON DELETE CASCADE,
  store_name text,
  mintsoft_channel text,
  sku text NOT NULL,
  base_sku text,
  pack_size integer,
  product_name text,
  brand_name text,
  units_sold bigint,
  revenue numeric,
  base_unit_cost numeric,
  pack_cost_unit numeric,
  cost_total numeric,
  real_fee_rate numeric,
  fees_total numeric,
  courier_total numeric,
  postage_unit numeric,
  profit numeric,
  por_pct numeric,
  current_price numeric,
  current_stock numeric,
  UNIQUE (snapshot_date, store_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_threeds_auto_snapshots_date
  ON public.threeds_reprice_auto_snapshots (snapshot_date DESC);

ALTER TABLE public.threeds_reprice_auto_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read threeds_auto_snapshots" ON public.threeds_reprice_auto_snapshots;
CREATE POLICY "auth read threeds_auto_snapshots" ON public.threeds_reprice_auto_snapshots
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service write threeds_auto_snapshots" ON public.threeds_reprice_auto_snapshots;
CREATE POLICY "service write threeds_auto_snapshots" ON public.threeds_reprice_auto_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);
