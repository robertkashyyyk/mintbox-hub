-- Supplier Stock Feeds — report + anomaly layer (Discovery → Supplier Feeds)
-- Backs the Hub "Supplier Feeds" page: which feeds exist, their run history, and the
-- per-SKU anomalies a run couldn't resolve (so they can be actioned, e.g. emailing
-- Mintsoft to reconcile a phantom OnHand).
--
-- Run history reuses agent_runs (run_type like 'supplier-feed-%'). These tables add
-- the feed registry + the structured anomaly list with a pre-drafted Mintsoft email.
-- Internal staff tool: authenticated reads, service_role writes (the feed worker).

-- ── Feed registry ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_feeds (
  supplier         text PRIMARY KEY,                 -- 'NGK', 'FG7', …
  display_name     text,
  enabled          boolean      NOT NULL DEFAULT true,
  warehouse_id     integer      NOT NULL DEFAULT 6,  -- Remote Warehouse (feeds-only)
  location_name    text         NOT NULL DEFAULT 'Primary',
  mapping_kind     text         NOT NULL DEFAULT 'algorithmic', -- 'algorithmic' (NGK) | 'table' (FG7)
  sku_prefix       text,                              -- NGK → 'NGK-' + zero-pad-5
  sftp_remote_path text,                              -- creds live in Supabase secrets, not here
  schedule_cron    text,
  last_run_at      timestamptz,
  last_run_summary jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.supplier_feeds (supplier, display_name, sku_prefix, sftp_remote_path, mapping_kind)
VALUES ('NGK', 'NGK / NTK', 'NGK-', '/EDI_Transfer/Parts Doc/PARTSDOC_INVRPT.CSV', 'algorithmic')
ON CONFLICT (supplier) DO NOTHING;

-- ── Anomalies (the actionable report) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_feed_anomalies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  supplier            text NOT NULL,
  sku                 text NOT NULL,
  mintsoft_product_id integer,
  warehouse_id        integer NOT NULL DEFAULT 6,
  anomaly_type        text NOT NULL,                 -- 'phantom_onhand' | 'infinite_stock' | 'allocation' | 'unmatched' | 'other'
  onhand              numeric,
  sellable            numeric,
  gap                 numeric,                        -- onhand - sellable (the phantom)
  feed_target         numeric,
  attempted_delta     numeric,
  detail              text,                           -- raw Mintsoft message
  email_subject       text,                           -- pre-drafted reconciliation email (phantom_onhand)
  email_body          text,
  status              text NOT NULL DEFAULT 'open',   -- 'open' | 'emailed' | 'resolved'
  resolved_at         timestamptz,
  resolved_by         uuid,
  last_seen_run_at    timestamptz NOT NULL DEFAULT now(),
  seen_count          integer NOT NULL DEFAULT 1
);

-- One OPEN row per (supplier, sku, type); re-runs refresh it rather than duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sfa_open
  ON public.supplier_feed_anomalies (supplier, sku, anomaly_type)
  WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_sfa_status ON public.supplier_feed_anomalies (status, created_at DESC);

-- updated_at touch for supplier_feeds
CREATE OR REPLACE FUNCTION public.touch_supplier_feeds() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_touch_supplier_feeds ON public.supplier_feeds;
CREATE TRIGGER trg_touch_supplier_feeds BEFORE UPDATE ON public.supplier_feeds
  FOR EACH ROW EXECUTE FUNCTION public.touch_supplier_feeds();

-- ── RLS: internal staff tool (authenticated read; service_role full) ───────────
ALTER TABLE public.supplier_feeds           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_feed_anomalies  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sf_read  ON public.supplier_feeds;
DROP POLICY IF EXISTS sfa_read ON public.supplier_feed_anomalies;
CREATE POLICY sf_read  ON public.supplier_feeds          FOR SELECT TO authenticated USING (true);
CREATE POLICY sfa_read ON public.supplier_feed_anomalies FOR SELECT TO authenticated USING (true);

-- Let staff mark anomalies resolved/emailed from the UI.
DROP POLICY IF EXISTS sfa_update ON public.supplier_feed_anomalies;
CREATE POLICY sfa_update ON public.supplier_feed_anomalies FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.supplier_feeds TO authenticated;
GRANT SELECT, UPDATE ON public.supplier_feed_anomalies TO authenticated;
GRANT ALL ON public.supplier_feeds, public.supplier_feed_anomalies TO service_role;
