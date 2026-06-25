-- ============================================================================
-- 20260617120000_amazon_fba.sql
-- Amazon FBA via SP-API — bring FBA demand / inventory / inbound / fees into
-- the Hub so we have a unified single-unit demand picture (eBay + FBM + FBA)
-- and a working FBA replenishment / LSA trigger.
--
-- Design adapted from `operator-datacore` (Shubhash Sharma, MIT, Seller
-- Sessions Live 2026). The reference uses separate meta/raw/brain/ops schemas;
-- here we fold everything into ONE isolated `amazon` schema so the FBA data
-- sits in its own namespace inside the production Hub DB, never polluting
-- `public`. Only a curated, frontend-facing replenishment view is exposed in
-- `public`.
--
-- GOVERNING RULE: every metric is read from the SP-API report that owns it
-- canonically. No reconstruction. Each canonical report lands verbatim in
-- amazon.raw_report / amazon.raw_event, then is parsed into the typed tables
-- below. (Reconstructing revenue from orders + maths under-counts 30-40%.)
--
-- v1 status: only amazon.sales_traffic_daily is actively populated by a pull
-- script. Every other canonical table is created up-front so its pull can be
-- activated without another migration.
--
-- PartsDoc-specific layers (NOT in the reference):
--   * marketplace_id on every row  -> FBA-UK and FBA-EU stay separate
--     (supports the EU wind-down; France retained).
--   * Q-code / multipack single-unit normalisation on order_items, matching
--     the Hub's existing parser:  base_sku = regexp_replace(sku,'(?i)-Q[0-9]+$','')
--     pack_size = GREATEST(COALESCE(NULLIF(substring(sku from '(?i)-Q([0-9]+)$'),'')::int,1),1)
--   * Two-bucket stock model: warehouse stock (Mintsoft, untouched) vs FBA
--     stock (on-hand + inbound) are NEVER merged. Demand is summed in single
--     units; stock stays split.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS amazon;
COMMENT ON SCHEMA amazon IS
'Amazon SP-API data lake (FBA). Raw landing + canonical per-source-row mirrors of SP-API reports + run tracking. One metric, one canonical report, no reconstruction. Adapted from operator-datacore (MIT).';

-- Lock the schema down: backend service (service_role) writes; nothing exposed
-- to anon. The frontend reads ONLY the curated public.v_fba_* views below.
REVOKE ALL ON SCHEMA amazon FROM PUBLIC;
GRANT USAGE ON SCHEMA amazon TO service_role;

-- ============================================================================
-- Single-unit SKU helpers — reuse the Hub's canonical Q-code parser so FBA
-- velocity normalises identically to 8020 / reprice / scorecard.
-- ============================================================================
CREATE OR REPLACE FUNCTION amazon.base_sku(p_sku TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT regexp_replace(COALESCE(p_sku, ''), '(?i)-Q[0-9]+$', '')
$$;
COMMENT ON FUNCTION amazon.base_sku(TEXT) IS
'Strip the -Qnn multipack suffix to the single-unit base SKU. Matches the Hub-wide parser.';

CREATE OR REPLACE FUNCTION amazon.pack_size(p_sku TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
    SELECT GREATEST(COALESCE(NULLIF(substring(COALESCE(p_sku, '') FROM '(?i)-Q([0-9]+)$'), '')::int, 1), 1)
$$;
COMMENT ON FUNCTION amazon.pack_size(TEXT) IS
'Units per pack encoded in the -Qnn suffix (Q03 = 3). Defaults to 1. Matches the Hub-wide parser.';

-- ============================================================================
-- amazon.connection — one row per SP-API connection (UK+EU = one connection,
-- multiple marketplace_ids). Tracks refresh-token rotation (LWA ~12 months).
-- Secrets live in .env / Supabase Vault — here we keep only a hash for audit.
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.connection (
    connection_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label                TEXT NOT NULL,                 -- 'partsdoc-eu'
    region               TEXT NOT NULL DEFAULT 'eu',    -- na | eu | fe
    marketplace_ids      TEXT[] NOT NULL DEFAULT '{}',
    auth_method          TEXT NOT NULL DEFAULT 'lwa_refresh_token',
    refresh_token_hash   TEXT,                          -- sha256 of refresh token, audit only
    token_issued_at      TIMESTAMPTZ,
    expires_at           TIMESTAMPTZ,                   -- rotate within 30 days of this
    status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','active','expired','revoked','error')),
    last_health_check_at TIMESTAMPTZ,
    last_health_check_ok BOOLEAN,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (label)
);
COMMENT ON TABLE amazon.connection IS
'SP-API connection. Refresh token hashed for rotation audit only; the real secret lives in .env / Vault.';

-- ============================================================================
-- amazon.sync_run — one row per pull attempt. "Is my FBA data fresh?" and
-- "did the last pull fail?" answered here.
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.sync_run (
    sync_run_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id  UUID NOT NULL REFERENCES amazon.connection(connection_id) ON DELETE CASCADE,
    object         TEXT NOT NULL,    -- 'sales_traffic' | 'orders' | 'financial_events' | 'fba_inventory' | ...
    mode           TEXT NOT NULL CHECK (mode IN ('backfill','incremental','manual','verification')),
    window_start   TIMESTAMPTZ,
    window_end     TIMESTAMPTZ,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at    TIMESTAMPTZ,
    status         TEXT NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','success','partial','failed','cancelled')),
    rows_fetched   BIGINT,
    rows_upserted  BIGINT,
    error_message  TEXT,
    next_cursor    JSONB,
    duration_ms    INTEGER GENERATED ALWAYS AS (
                       CASE WHEN finished_at IS NULL THEN NULL
                            ELSE (EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)::INTEGER END
                   ) STORED
);
CREATE INDEX IF NOT EXISTS idx_amz_sync_run_conn_started ON amazon.sync_run (connection_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_amz_sync_run_object_status ON amazon.sync_run (object, status, started_at DESC);

-- ============================================================================
-- amazon.marketplace — reference (EU subset relevant to PartsDoc + US).
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.marketplace (
    marketplace_id      TEXT PRIMARY KEY,
    region              TEXT NOT NULL,
    country_code        CHAR(2) NOT NULL,
    country_name        TEXT NOT NULL,
    native_currency     CHAR(3) NOT NULL,
    accounting_timezone TEXT NOT NULL,
    seller_central_url  TEXT
);
INSERT INTO amazon.marketplace (marketplace_id, region, country_code, country_name, native_currency, accounting_timezone, seller_central_url) VALUES
    ('A1F83G8C2ARO7P', 'eu', 'GB', 'United Kingdom', 'GBP', 'Europe/London',    'https://sellercentral.amazon.co.uk'),
    ('A13V1IB3VIYZZH', 'eu', 'FR', 'France',         'EUR', 'Europe/Paris',     'https://sellercentral.amazon.fr'),
    ('A1PA6795UKMFR9', 'eu', 'DE', 'Germany',        'EUR', 'Europe/Berlin',    'https://sellercentral.amazon.de'),
    ('APJ6JRA9NG5V4',  'eu', 'IT', 'Italy',          'EUR', 'Europe/Rome',      'https://sellercentral.amazon.it'),
    ('A1RKKUPIHCS9HS', 'eu', 'ES', 'Spain',          'EUR', 'Europe/Madrid',    'https://sellercentral.amazon.es'),
    ('A1805IZSGTT6HS', 'eu', 'NL', 'Netherlands',    'EUR', 'Europe/Amsterdam', 'https://sellercentral.amazon.nl'),
    ('ATVPDKIKX0DER',  'na', 'US', 'United States',  'USD', 'America/Los_Angeles','https://sellercentral.amazon.com')
ON CONFLICT (marketplace_id) DO NOTHING;

-- ============================================================================
-- amazon.report_catalog — the metric ownership map, queryable from SQL.
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.report_catalog (
    metric            TEXT PRIMARY KEY,
    canonical_source  TEXT NOT NULL,
    lands_in          TEXT NOT NULL,
    granularity       TEXT,
    active_in_v1      BOOLEAN NOT NULL DEFAULT FALSE,
    notes             TEXT
);
INSERT INTO amazon.report_catalog (metric, canonical_source, lands_in, granularity, active_in_v1, notes) VALUES
    ('FBA velocity / demand', 'GET_SALES_AND_TRAFFIC_REPORT', 'amazon.sales_traffic_daily', 'day x ASIN', TRUE,
        'One report per DAY for day x ASIN. Buy-box/conversion come 0-100, stored 0.0-1.0. Requires Brand Analytics enrolment.'),
    ('Order-level detail', 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL', 'amazon.orders + amazon.order_items', 'order line', FALSE,
        'BY_LAST_UPDATE_GENERAL catches status changes. PII stripped (intended). FBA=AFN, FBM=MFN.'),
    ('Fees (referral, FBA, storage)', 'Finances API -> listFinancialEvents', 'amazon.financial_events', 'event', FALSE,
        'Fees come back NEGATIVE -> sign-flip, store abs in amount + direction, raw in original_amount. Chunk windows to 7 days; re-pull last 30.'),
    ('FBA on-hand', 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA', 'amazon.fba_inventory_snapshot', 'day x SKU', FALSE,
        'Snapshot != available everywhere. Reconcile against the ledger.'),
    ('FBA reserved (3 buckets)', 'GET_RESERVED_INVENTORY_DATA', 'amazon.fba_reserved_inventory', 'snapshot x SKU', FALSE,
        'Three buckets: customer orders, FC transfers, FC processing. NEVER sum into one.'),
    ('Inbound / in-transit', 'GET_LEDGER_DETAIL_VIEW_DATA', 'amazon.inventory_ledger_detail', 'movement', FALSE,
        'Warehouse-drawdown / in-transit. 18-month lookback. No double counting vs on-hand.')
ON CONFLICT (metric) DO NOTHING;

-- ============================================================================
-- RAW LANDING — every SP-API response stored verbatim before parsing.
-- Re-parsable (parser bug -> re-parse, no re-fetch) and auditable.
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.raw_report (
    raw_id            BIGSERIAL PRIMARY KEY,
    connection_id     UUID NOT NULL REFERENCES amazon.connection(connection_id) ON DELETE CASCADE,
    sync_run_id       UUID REFERENCES amazon.sync_run(sync_run_id) ON DELETE SET NULL,
    report_type       TEXT NOT NULL,
    report_id         TEXT NOT NULL,
    document_id       TEXT,
    marketplace_ids   TEXT[],
    data_start_time   TIMESTAMPTZ,
    data_end_time     TIMESTAMPTZ,
    processing_status TEXT,
    payload           JSONB NOT NULL,
    payload_bytes     INTEGER,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    parsed_at         TIMESTAMPTZ,
    parse_error       TEXT,
    UNIQUE (report_type, report_id)
);
CREATE INDEX IF NOT EXISTS idx_amz_raw_report_type_window ON amazon.raw_report (report_type, data_start_time, data_end_time);
CREATE INDEX IF NOT EXISTS idx_amz_raw_report_unparsed   ON amazon.raw_report (report_type, fetched_at) WHERE parsed_at IS NULL;

CREATE TABLE IF NOT EXISTS amazon.raw_event (
    raw_id           BIGSERIAL PRIMARY KEY,
    connection_id    UUID NOT NULL REFERENCES amazon.connection(connection_id) ON DELETE CASCADE,
    sync_run_id      UUID REFERENCES amazon.sync_run(sync_run_id) ON DELETE SET NULL,
    endpoint         TEXT NOT NULL,            -- 'listFinancialEvents', 'getCatalogItem', ...
    request_params   JSONB,
    response_payload JSONB NOT NULL,
    next_token       TEXT,
    fetched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    parsed_at        TIMESTAMPTZ,
    parse_error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_amz_raw_event_endpoint ON amazon.raw_event (endpoint, fetched_at DESC);

-- ============================================================================
-- amazon.sales_traffic_daily  — ACTIVE in v1
-- Source: GET_SALES_AND_TRAFFIC_REPORT (Brand Analytics)
-- Canonical revenue/units/sessions per child ASIN per day per marketplace.
-- Same numbers as Seller Central -> Business Reports.
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.sales_traffic_daily (
    marketplace_id              TEXT NOT NULL,
    metric_date                 DATE NOT NULL,
    parent_asin                 TEXT NOT NULL,
    child_asin                  TEXT NOT NULL,
    sku                         TEXT,
    currency_code               CHAR(3) NOT NULL,
    ordered_product_sales       NUMERIC(18,2) NOT NULL DEFAULT 0,
    ordered_product_sales_b2b   NUMERIC(18,2) NOT NULL DEFAULT 0,
    units_ordered               INTEGER NOT NULL DEFAULT 0,
    units_ordered_b2b           INTEGER NOT NULL DEFAULT 0,
    total_order_items           INTEGER NOT NULL DEFAULT 0,
    total_order_items_b2b       INTEGER NOT NULL DEFAULT 0,
    sessions                    INTEGER NOT NULL DEFAULT 0,
    sessions_b2b                INTEGER NOT NULL DEFAULT 0,
    browser_sessions            INTEGER NOT NULL DEFAULT 0,
    browser_sessions_b2b        INTEGER NOT NULL DEFAULT 0,
    mobile_app_sessions         INTEGER NOT NULL DEFAULT 0,
    mobile_app_sessions_b2b     INTEGER NOT NULL DEFAULT 0,
    page_views                  INTEGER NOT NULL DEFAULT 0,
    page_views_b2b              INTEGER NOT NULL DEFAULT 0,
    browser_page_views          INTEGER NOT NULL DEFAULT 0,
    browser_page_views_b2b      INTEGER NOT NULL DEFAULT 0,
    mobile_app_page_views       INTEGER NOT NULL DEFAULT 0,
    mobile_app_page_views_b2b   INTEGER NOT NULL DEFAULT 0,
    buy_box_percentage          NUMERIC(7,4),     -- 0.0000..1.0000
    buy_box_percentage_b2b      NUMERIC(7,4),
    unit_session_percentage     NUMERIC(7,4),     -- Amazon's own conversion rate
    unit_session_percentage_b2b NUMERIC(7,4),
    raw_id                      BIGINT REFERENCES amazon.raw_report(raw_id) ON DELETE SET NULL,
    ingested_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (marketplace_id, metric_date, child_asin)
);
CREATE INDEX IF NOT EXISTS idx_amz_st_date        ON amazon.sales_traffic_daily (metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_amz_st_sku_date    ON amazon.sales_traffic_daily (sku, metric_date DESC) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amz_st_mp_date     ON amazon.sales_traffic_daily (marketplace_id, metric_date DESC);
COMMENT ON COLUMN amazon.sales_traffic_daily.ordered_product_sales IS
'Native-currency revenue Amazon shows the seller. The single source of truth for FBA revenue. Never reconstruct this.';

-- ============================================================================
-- amazon.orders / amazon.order_items  — scaffolded
-- Source: GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL
-- order_items carries the PartsDoc single-unit layer (base_sku / pack_size /
-- single_units) so FBA demand sums in single units alongside eBay + FBM.
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.orders (
    marketplace_id      TEXT NOT NULL,
    amazon_order_id     TEXT NOT NULL,
    merchant_order_id   TEXT,
    purchase_date       TIMESTAMPTZ,
    last_updated_date   TIMESTAMPTZ,
    order_status        TEXT,
    fulfillment_channel TEXT,             -- AFN = FBA, MFN = FBM
    sales_channel       TEXT,
    ship_service_level  TEXT,
    is_business_order   BOOLEAN,
    ship_country        CHAR(2),
    ship_postal_code    TEXT,
    -- PII (buyer name/email/address) is NEVER stored here.
    raw_id              BIGINT REFERENCES amazon.raw_report(raw_id) ON DELETE SET NULL,
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (marketplace_id, amazon_order_id)
);
CREATE INDEX IF NOT EXISTS idx_amz_orders_purchase ON amazon.orders (purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_amz_orders_channel  ON amazon.orders (fulfillment_channel, purchase_date DESC);

CREATE TABLE IF NOT EXISTS amazon.order_items (
    amazon_order_id     TEXT NOT NULL,
    order_item_id       TEXT NOT NULL,
    marketplace_id      TEXT,
    asin                TEXT,
    sku                 TEXT,
    -- PartsDoc single-unit layer (Q-code normalised). Generated so it can
    -- never drift from `sku`; single_units = quantity * pack_size.
    base_sku            TEXT GENERATED ALWAYS AS (amazon.base_sku(sku)) STORED,
    pack_size           INTEGER GENERATED ALWAYS AS (amazon.pack_size(sku)) STORED,
    product_name        TEXT,
    quantity            INTEGER NOT NULL DEFAULT 0,
    quantity_shipped    INTEGER NOT NULL DEFAULT 0,
    single_units        INTEGER GENERATED ALWAYS AS (quantity * amazon.pack_size(sku)) STORED,
    item_price          NUMERIC(18,2),
    item_tax            NUMERIC(18,2),
    shipping_price      NUMERIC(18,2),
    item_promotion_discount NUMERIC(18,2),
    currency_code       CHAR(3),
    raw_id              BIGINT REFERENCES amazon.raw_report(raw_id) ON DELETE SET NULL,
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (amazon_order_id, order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_amz_order_items_asin     ON amazon.order_items (asin);
CREATE INDEX IF NOT EXISTS idx_amz_order_items_base_sku ON amazon.order_items (base_sku);

-- ============================================================================
-- amazon.financial_events  — scaffolded
-- Source: Finances API -> listFinancialEvents
-- GOTCHA: fees come back NEGATIVE. Parser flips sign, stores abs in `amount`
-- with `direction`, raw in `original_amount`. De-dupe on event_hash.
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.financial_events (
    event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace_id  TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    event_subtype   TEXT,
    posted_date     TIMESTAMPTZ NOT NULL,
    amazon_order_id TEXT,
    sku             TEXT,
    asin            TEXT,
    amount          NUMERIC(18,2) NOT NULL,                 -- absolute, always positive
    direction       TEXT NOT NULL CHECK (direction IN ('credit','debit')),
    original_amount NUMERIC(18,2) NOT NULL,                 -- raw value Amazon sent (may be negative)
    currency_code   CHAR(3) NOT NULL,
    fee_description TEXT,
    event_hash      TEXT NOT NULL,
    raw_id          BIGINT REFERENCES amazon.raw_event(raw_id) ON DELETE SET NULL,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (marketplace_id, event_type, posted_date, event_hash)
);
CREATE INDEX IF NOT EXISTS idx_amz_fin_order  ON amazon.financial_events (amazon_order_id) WHERE amazon_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amz_fin_posted ON amazon.financial_events (posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_amz_fin_sku    ON amazon.financial_events (sku) WHERE sku IS NOT NULL;

-- ============================================================================
-- amazon.fba_inventory_snapshot  — scaffolded   (on-hand)
-- Source: GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.fba_inventory_snapshot (
    snapshot_date                  DATE NOT NULL,
    marketplace_id                 TEXT NOT NULL,
    sku                            TEXT NOT NULL,
    fnsku                          TEXT,
    asin                           TEXT,
    product_name                   TEXT,
    afn_listing_exists             BOOLEAN,
    afn_warehouse_quantity         INTEGER NOT NULL DEFAULT 0,
    afn_fulfillable_quantity       INTEGER NOT NULL DEFAULT 0,
    afn_unsellable_quantity        INTEGER NOT NULL DEFAULT 0,
    afn_reserved_quantity          INTEGER NOT NULL DEFAULT 0,
    afn_total_quantity             INTEGER NOT NULL DEFAULT 0,
    afn_inbound_working_quantity   INTEGER NOT NULL DEFAULT 0,
    afn_inbound_shipped_quantity   INTEGER NOT NULL DEFAULT 0,
    afn_inbound_receiving_quantity INTEGER NOT NULL DEFAULT 0,
    raw_id                         BIGINT REFERENCES amazon.raw_report(raw_id) ON DELETE SET NULL,
    ingested_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_date, marketplace_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_amz_fba_inv_sku ON amazon.fba_inventory_snapshot (sku, snapshot_date DESC);

-- ============================================================================
-- amazon.fba_reserved_inventory  — scaffolded   (3 buckets, never summed)
-- Source: GET_RESERVED_INVENTORY_DATA
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.fba_reserved_inventory (
    snapshot_at                  TIMESTAMPTZ NOT NULL,
    marketplace_id               TEXT NOT NULL,
    sku                          TEXT NOT NULL,
    fnsku                        TEXT,
    asin                         TEXT,
    reserved_qty_customer_orders INTEGER NOT NULL DEFAULT 0,
    reserved_qty_fc_transfers    INTEGER NOT NULL DEFAULT 0,
    reserved_qty_fc_processing   INTEGER NOT NULL DEFAULT 0,
    raw_id                       BIGINT REFERENCES amazon.raw_report(raw_id) ON DELETE SET NULL,
    ingested_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_at, marketplace_id, sku)
);

-- ============================================================================
-- amazon.inventory_ledger_detail  — scaffolded   (inbound / in-transit)
-- Source: GET_LEDGER_DETAIL_VIEW_DATA (18-month lookback)
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.inventory_ledger_detail (
    event_date         DATE NOT NULL,
    marketplace_id     TEXT NOT NULL,
    fnsku              TEXT,
    asin               TEXT,
    sku                TEXT NOT NULL,
    title              TEXT,
    event_type         TEXT NOT NULL,    -- Receipts, CustomerShipments, CustomerReturns, ...
    reference_id       TEXT NOT NULL,
    quantity           INTEGER NOT NULL,
    fulfillment_center TEXT,
    disposition        TEXT,
    country            CHAR(2),
    raw_id             BIGINT REFERENCES amazon.raw_report(raw_id) ON DELETE SET NULL,
    ingested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_date, marketplace_id, sku, event_type, reference_id)
);
CREATE INDEX IF NOT EXISTS idx_amz_ledger_sku ON amazon.inventory_ledger_detail (sku, event_date DESC);

-- ============================================================================
-- amazon.replenishment_config — tunables for the restock formula.
--   target_weeks_cover = lead_time + safety + cycle buffer.
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.replenishment_config (
    id                   BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),  -- single-row guard
    target_weeks_cover   NUMERIC(6,2) NOT NULL DEFAULT 6.0,
    default_moq          INTEGER NOT NULL DEFAULT 1,
    velocity_weeks       INTEGER NOT NULL DEFAULT 8,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO amazon.replenishment_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- amazon.v_fba_velocity — trailing 8-week weighted weekly velocity, in SINGLE
-- UNITS, per (marketplace, base_sku). Recent weeks weighted heavier (linear
-- 8..1). Built from sales_traffic_daily AFTER Q-code normalisation.
--
-- S&T's units_ordered is per child ASIN at the pack level; we multiply by
-- pack_size to get single units, then roll up to base_sku so packs that draw
-- from the same warehouse bin are never counted as separate demand.
-- ============================================================================
CREATE OR REPLACE VIEW amazon.v_fba_velocity AS
WITH cfg AS (SELECT velocity_weeks FROM amazon.replenishment_config WHERE id),
weekly AS (
    SELECT
        st.marketplace_id,
        amazon.base_sku(st.sku)                                          AS base_sku,
        FLOOR((CURRENT_DATE - st.metric_date) / 7)::int                  AS week_index,    -- 0 = most recent
        SUM(st.units_ordered * amazon.pack_size(st.sku))::numeric        AS single_units
    FROM amazon.sales_traffic_daily st, cfg
    WHERE st.sku IS NOT NULL
      AND st.metric_date >= CURRENT_DATE - (cfg.velocity_weeks * 7)
    GROUP BY 1, 2, 3
)
SELECT
    w.marketplace_id,
    w.base_sku,
    -- weighted weekly velocity: weight = velocity_weeks - week_index (recent heavier)
    ROUND(
        SUM(w.single_units * (c.velocity_weeks - w.week_index))
        / NULLIF(SUM(c.velocity_weeks - w.week_index), 0)
    , 2)                                                                 AS weekly_velocity,
    SUM(w.single_units) FILTER (WHERE w.week_index = 0)                  AS units_7d,
    SUM(w.single_units) FILTER (WHERE w.week_index <= 3)                 AS units_30d,
    SUM(w.single_units)                                                  AS units_window
FROM weekly w, cfg c
GROUP BY 1, 2;
COMMENT ON VIEW amazon.v_fba_velocity IS
'Trailing N-week weighted weekly FBA velocity in single units, per (marketplace, base_sku). Q-code normalised.';

-- ============================================================================
-- amazon.v_fba_replenishment — the LSA / restock trigger.
--   target_units    = target_weeks_cover * weekly_velocity
--   on_hand         = SUM(afn_fulfillable_quantity)           [latest snapshot]
--   in_transit      = inbound_working + inbound_shipped + inbound_receiving
--   units_to_order  = ceil(MAX(0, target_units - on_hand - in_transit)) -> MOQ
-- Inventory tables are scaffolded; until their pulls run, on_hand/in_transit
-- are 0 and the flag surfaces velocity that has no visible FBA cover.
-- ============================================================================
CREATE OR REPLACE VIEW amazon.v_fba_replenishment AS
WITH cfg AS (SELECT target_weeks_cover, default_moq FROM amazon.replenishment_config WHERE id),
inv AS (   -- latest on-hand snapshot per (marketplace, base_sku)
    SELECT s.marketplace_id, amazon.base_sku(s.sku) AS base_sku,
           SUM(s.afn_fulfillable_quantity * amazon.pack_size(s.sku)) AS on_hand_units,
           SUM((s.afn_inbound_working_quantity + s.afn_inbound_shipped_quantity
                + s.afn_inbound_receiving_quantity) * amazon.pack_size(s.sku)) AS in_transit_units
    FROM amazon.fba_inventory_snapshot s
    JOIN (SELECT marketplace_id, MAX(snapshot_date) AS d
          FROM amazon.fba_inventory_snapshot GROUP BY 1) latest
      ON latest.marketplace_id = s.marketplace_id AND latest.d = s.snapshot_date
    GROUP BY 1, 2
)
SELECT
    v.marketplace_id,
    m.country_code,
    v.base_sku,
    v.weekly_velocity,
    v.units_7d,
    v.units_30d,
    COALESCE(inv.on_hand_units, 0)                                       AS fba_on_hand,
    COALESCE(inv.in_transit_units, 0)                                    AS fba_in_transit,
    ROUND(cfg.target_weeks_cover * v.weekly_velocity, 1)                 AS target_units,
    CASE WHEN v.weekly_velocity > 0
         THEN ROUND((COALESCE(inv.on_hand_units,0) + COALESCE(inv.in_transit_units,0))
                    / v.weekly_velocity, 1)
         ELSE NULL END                                                   AS days_of_cover_weeks,
    GREATEST(0, CEIL(cfg.target_weeks_cover * v.weekly_velocity
                     - COALESCE(inv.on_hand_units,0) - COALESCE(inv.in_transit_units,0)))::int
        AS raw_units_to_order,
    CEIL(
        GREATEST(0, CEIL(cfg.target_weeks_cover * v.weekly_velocity
                         - COALESCE(inv.on_hand_units,0) - COALESCE(inv.in_transit_units,0)))::numeric
        / cfg.default_moq
    )::int * cfg.default_moq                                             AS units_to_order,
    (cfg.target_weeks_cover * v.weekly_velocity
        - COALESCE(inv.on_hand_units,0) - COALESCE(inv.in_transit_units,0)) > 0
        AS replenish_flag
FROM amazon.v_fba_velocity v
JOIN amazon.marketplace m ON m.marketplace_id = v.marketplace_id
CROSS JOIN cfg
LEFT JOIN inv ON inv.marketplace_id = v.marketplace_id AND inv.base_sku = v.base_sku
WHERE v.weekly_velocity > 0;
COMMENT ON VIEW amazon.v_fba_replenishment IS
'Per (marketplace, base_sku) FBA restock trigger. target = weeks_cover*velocity; units_to_order rounded up to MOQ. Stock split from warehouse (Mintsoft) — never merged.';

-- ============================================================================
-- FRONTEND-FACING VIEW (public). The Hub frontend reads ONLY this, via the
-- supabase-js client. Internal-staff tool: authenticated may read; anon may not.
-- ============================================================================
CREATE OR REPLACE VIEW public.v_fba_replenishment AS
    SELECT * FROM amazon.v_fba_replenishment;
COMMENT ON VIEW public.v_fba_replenishment IS
'Frontend-facing FBA replenishment / LSA trigger. Curated read of amazon.v_fba_replenishment. Internal staff tool.';

REVOKE ALL ON public.v_fba_replenishment FROM anon;
GRANT SELECT ON public.v_fba_replenishment TO authenticated;

COMMIT;
