-- Klokkerholm wiring (Phase 1 shadow): proposals table + per-supplier location + feed
-- registration. Everything here supports SHADOW — proposals are written, nothing applies.

-- Per-supplier booking location (NGK/others default to Primary; Klokkerholm = its own bucket).
ALTER TABLE public.supplier_feeds ADD COLUMN IF NOT EXISTS location_id integer NOT NULL DEFAULT 32947;

-- Register the Klokkerholm feed. mapping is algorithmic (KKH- + partnumber w/o dash);
-- targets come from state (IN STOCK 999 / OUT 0 / CRITICAL 1); do-not-sell forces 0.
INSERT INTO public.supplier_feeds (supplier, display_name, mapping_kind, sku_prefix, warehouse_id, location_id, enabled)
VALUES ('KKH', 'Klokkerholm', 'algorithmic', 'KKH-', 6, 35339, false)  -- enabled=false: shadow only until approved
ON CONFLICT (supplier) DO UPDATE SET location_id = EXCLUDED.location_id, display_name = EXCLUDED.display_name;

-- Shadow proposal set — every StockIn/StockOut a run WOULD fire, old→new, applied nothing.
CREATE TABLE IF NOT EXISTS public.supplier_feed_proposals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL,
  supplier     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sku          text NOT NULL,
  mintsoft_product_id integer,
  action       text NOT NULL,                 -- 'StockIn' | 'StockOut'
  qty          integer NOT NULL,
  old_qty      integer,
  new_qty      integer,
  location_id  integer,
  do_not_sell  boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'proposed',  -- 'proposed' | 'applied' | 'skipped'
  applied_at   timestamptz,
  detail       text
);
CREATE INDEX IF NOT EXISTS idx_sfp_run    ON public.supplier_feed_proposals (run_id);
CREATE INDEX IF NOT EXISTS idx_sfp_status ON public.supplier_feed_proposals (supplier, status);

-- Run header — one row per shadow run, with the sanity summary.
CREATE TABLE IF NOT EXISTS public.supplier_feed_proposal_runs (
  run_id       uuid PRIMARY KEY,
  supplier     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  mode         text NOT NULL DEFAULT 'shadow',   -- 'shadow' | 'live'
  feed_rows    integer,
  in_scope     integer,
  dropped      integer,
  stock_in     integer,
  stock_out    integer,
  noop         integer,
  no_record    integer,
  dns_suppressed integer,                        -- would-be activations blocked by do-not-sell
  summary      jsonb
);

ALTER TABLE public.supplier_feed_proposals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_feed_proposal_runs  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sfp_read  ON public.supplier_feed_proposals;
DROP POLICY IF EXISTS sfpr_read ON public.supplier_feed_proposal_runs;
CREATE POLICY sfp_read  ON public.supplier_feed_proposals     FOR SELECT TO authenticated USING (true);
CREATE POLICY sfpr_read ON public.supplier_feed_proposal_runs FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.supplier_feed_proposals, public.supplier_feed_proposal_runs TO authenticated;
GRANT ALL ON public.supplier_feed_proposals, public.supplier_feed_proposal_runs TO service_role;
