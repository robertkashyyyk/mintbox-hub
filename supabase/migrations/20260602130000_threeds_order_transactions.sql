-- 3D Sellers Orders ingestion: capture the real eBay listing layer.
--
-- WHY: order_line_economics joins products_cache by EXACT sku and uses 90-day
-- averages, so it conflates Q-variants and has no eBay item number, no real
-- per-listing price, no real fee. The 3DS /v1/orders feed carries all of that
-- per transaction (sku incl Q-code, externalItemId = eBay item number, gross
-- price, real finalValueFee, marketplace). This table is the source of truth
-- for "which listings exist for a SKU and what do they really cost us".
--
-- WRITE PATH: edge function `ingest-3ds-orders` (service role) upserts here.
-- READ PATH: authenticated app reads via the threeds_listings view.

-- One row per 3DS order line-item (transaction). Idempotent on transaction_id.
CREATE TABLE IF NOT EXISTS public.threeds_order_transactions (
  transaction_id    text PRIMARY KEY,            -- 3DS orderLineItemId (stable eBay transaction id)
  order_id          text,                        -- 3DS order id
  order_external_id text,                        -- marketplace order id (e.g. eBay order)
  seller_id         bigint,                      -- 3DS seller id
  channel           text,                        -- 'ebay'
  store_name        text,                        -- seller store name/slug (for display)
  store_url         text,                        -- live store URL
  marketplace       text,                        -- 'UK' | 'ES' | 'FR' | ... (derived from siteId/currency)
  sku               text,                        -- eBay custom label, incl Q-codes (e.g. HOL-RW2R-Q02)
  -- base_sku: sku with any trailing -Q<digits> stripped (Q-variants roll up to parent)
  base_sku          text GENERATED ALWAYS AS (regexp_replace(sku, '(?i)-Q[0-9]+$', '')) STORED,
  -- q_code: the trailing -Q<digits> token if present, else NULL
  q_code            text GENERATED ALWAYS AS (substring(sku from '(?i)-Q[0-9]+$')) STORED,
  external_item_id  text,                        -- eBay item number
  item_name         text,
  item_url          text,
  price             numeric,                     -- GROSS line total (inc VAT); for qty>1 this is the line, not per-unit
  quantity          integer,
  unit_price        numeric,                     -- GROSS per-unit = price / quantity (computed on ingest)
  currency          text,
  final_value_fee   numeric,                     -- REAL eBay FVF for the line
  order_date        timestamptz,
  status            text,
  cancel_status     text,
  raw               jsonb,                       -- full transaction payload, future-proofing
  ingested_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS threeds_tx_base_sku_idx     ON public.threeds_order_transactions (base_sku);
CREATE INDEX IF NOT EXISTS threeds_tx_sku_idx          ON public.threeds_order_transactions (sku);
CREATE INDEX IF NOT EXISTS threeds_tx_item_id_idx      ON public.threeds_order_transactions (external_item_id);
CREATE INDEX IF NOT EXISTS threeds_tx_order_date_idx   ON public.threeds_order_transactions (order_date DESC);
CREATE INDEX IF NOT EXISTS threeds_tx_seller_idx       ON public.threeds_order_transactions (seller_id);

COMMENT ON TABLE public.threeds_order_transactions IS
  '3D Sellers order line-items (eBay transactions). Source of truth for per-listing item number, real price, real FVF. Upserted by ingest-3ds-orders edge fn.';

-- Per-seller ingestion progress, so backfill can resume across invocations and
-- incremental runs know where they got to.
CREATE TABLE IF NOT EXISTS public.threeds_ingest_state (
  seller_id           bigint PRIMARY KEY,
  store_name          text,
  marketplace         text,
  channel             text,
  backfill_done       boolean NOT NULL DEFAULT false,
  backfill_next_page  integer NOT NULL DEFAULT 1,
  reported_total      integer,                   -- API metadata.total at last sight
  last_run_at         timestamptz,
  last_new_rows       integer,
  last_seen_max_date  timestamptz
);

COMMENT ON TABLE public.threeds_ingest_state IS
  'Per-seller cursor/progress for ingest-3ds-orders (backfill page + incremental high-water mark).';

-- Listing-level rollup the app reads: one row per (base_sku, sku, eBay item
-- number, marketplace). Gives the eBay item number, marketplace, latest gross
-- price, 90-day units, and the REAL fee rate (Σfvf/Σprice) per listing.
CREATE OR REPLACE VIEW public.threeds_listings AS
SELECT
  t.base_sku,
  t.sku,
  t.q_code,
  t.external_item_id,
  t.marketplace,
  t.channel,
  t.store_name,
  max(t.item_name)                                                              AS item_name,
  max(t.item_url)                                                               AS item_url,
  max(t.currency)                                                              AS currency,
  -- latest gross unit price from the most recent non-cancelled sale
  (array_agg(t.unit_price ORDER BY t.order_date DESC)
     FILTER (WHERE coalesce(lower(t.cancel_status), '') NOT IN ('cancelled', 'canceled')))[1]
                                                                                AS last_unit_price,
  max(t.order_date)                                                             AS last_order_date,
  count(*) FILTER (WHERE t.order_date >= now() - interval '90 days')            AS orders_90d,
  coalesce(sum(t.quantity)        FILTER (WHERE t.order_date >= now() - interval '90 days'), 0) AS units_90d,
  coalesce(sum(t.price)           FILTER (WHERE t.order_date >= now() - interval '90 days'), 0) AS revenue_90d,
  coalesce(sum(t.final_value_fee) FILTER (WHERE t.order_date >= now() - interval '90 days'), 0) AS fvf_90d,
  CASE
    WHEN coalesce(sum(t.price) FILTER (WHERE t.order_date >= now() - interval '90 days'), 0) > 0
    THEN sum(t.final_value_fee) FILTER (WHERE t.order_date >= now() - interval '90 days')
       / sum(t.price)           FILTER (WHERE t.order_date >= now() - interval '90 days')
    ELSE NULL
  END                                                                           AS real_fee_rate
FROM public.threeds_order_transactions t
WHERE t.external_item_id IS NOT NULL
GROUP BY t.base_sku, t.sku, t.q_code, t.external_item_id, t.marketplace, t.channel, t.store_name;

COMMENT ON VIEW public.threeds_listings IS
  'Per-listing rollup of threeds_order_transactions: eBay item number, marketplace, latest gross price, 90d units, REAL fee rate. Grouped by base_sku so Q-variants roll up to their parent.';

-- RLS: app reads with the authenticated role; edge fn writes with service role
-- (bypasses RLS). Read-only for authenticated users.
ALTER TABLE public.threeds_order_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threeds_ingest_state        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read 3ds transactions"
  ON public.threeds_order_transactions
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can read 3ds ingest state"
  ON public.threeds_ingest_state
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

GRANT SELECT ON public.threeds_order_transactions TO authenticated;
GRANT SELECT ON public.threeds_ingest_state        TO authenticated;
GRANT SELECT ON public.threeds_listings            TO authenticated;
