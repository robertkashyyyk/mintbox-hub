-- ============================================================================
-- 20260702130000_amazon_esagu_item.sql
-- Phase 1 mirror for Amazon repricing via eSagu. amazon.esagu_item = one row
-- per eSagu repricing item (GET /item), with its current strategy (min/max/
-- fixed/mode), fulfilment (FBA/FBM), and the buy-box picture from offers[].
-- Resolves catalogue_sku via amazon.asin_sku_map (ASIN is the join key —
-- eSagu's sku has no hyphen, e.g. NGK92579 vs our NGK-92579).
--
-- Thin ingest RPC (edge fn esagu-sync-items does the SP-API-style pull +
-- buy-box parsing, hands clean rows here). Mirrors amazon_ingest_* pattern.
--
-- Prices arrive in GBP (edge fn converts eSagu pennies → £). UK only.
-- eSagu auth uses secret ESAGU_KEY (the JWT), NOT ESAGU_JWT (see probe).
-- ============================================================================

CREATE TABLE IF NOT EXISTS amazon.esagu_item (
    esagu_item_id           BIGINT PRIMARY KEY,               -- eSagu 'id' → PUT /item/{id}/strategy
    marketplace_id          TEXT NOT NULL DEFAULT 'A1F83G8C2ARO7P',
    esagu_sku               TEXT,                             -- eSagu's sku (no hyphen)
    asin                    TEXT,
    catalogue_sku           TEXT,                             -- resolved Hub products_cache.sku (via asin_sku_map)
    title                   TEXT,
    fba                     BOOLEAN,
    prime                   BOOLEAN,
    quantity                INTEGER,
    merchant_shipping_group TEXT,
    amazon_price            NUMERIC(12,2),                    -- current Amazon price (£)
    min_price               NUMERIC(12,2),                    -- current eSagu strategy floor
    max_price               NUMERIC(12,2),
    fixed_price             NUMERIC(12,2),
    mode                    TEXT,                             -- OPTIMIZATION / ...
    buy_box_seller          TEXT,                             -- sellerId of the buy-box winner
    buy_box_price           NUMERIC(12,2),                    -- winner's landed price (£)
    is_our_buybox           BOOLEAN,                          -- did WE win it (null until our sellerIds known)
    offer_count             INTEGER,
    strategy                JSONB,                            -- full priceSettings + template refs
    offers                  JSONB,                            -- trimmed [{seller,price,flags}]
    esagu_inserted          TIMESTAMPTZ,
    esagu_updated           TIMESTAMPTZ,
    offers_updated          TIMESTAMPTZ,
    synced_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_esagu_item_asin      ON amazon.esagu_item (asin);
CREATE INDEX IF NOT EXISTS idx_esagu_item_cat_sku   ON amazon.esagu_item (catalogue_sku) WHERE catalogue_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_esagu_item_fba       ON amazon.esagu_item (fba);

-- ---------------------------------------------------------------------------
-- Thin ingest: edge fn passes an array of already-parsed items (GBP prices,
-- buy-box extracted). Upsert + resolve catalogue_sku via asin_sku_map.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.amazon_ingest_esagu_items(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, amazon
SET statement_timeout = '180s'
AS $$
DECLARE
    v_conn UUID := amazon._ensure_connection('A1F83G8C2ARO7P');
    v_run  UUID;
    v_n    INTEGER;
BEGIN
    INSERT INTO amazon.sync_run (connection_id, object, mode, status)
    VALUES (v_conn, 'esagu_items', 'incremental', 'running') RETURNING sync_run_id INTO v_run;

    INSERT INTO amazon.esagu_item AS e (
        esagu_item_id, marketplace_id, esagu_sku, asin, catalogue_sku, title, fba, prime, quantity,
        merchant_shipping_group, amazon_price, min_price, max_price, fixed_price, mode,
        buy_box_seller, buy_box_price, is_our_buybox, offer_count, strategy, offers,
        esagu_inserted, esagu_updated, offers_updated, synced_at)
    SELECT
        (r->>'id')::bigint, 'A1F83G8C2ARO7P', NULLIF(r->>'sku',''), NULLIF(r->>'asin',''), m.catalogue_sku,
        NULLIF(r->>'title',''), (r->>'fba')::boolean, (r->>'prime')::boolean, NULLIF(r->>'quantity','')::int,
        NULLIF(r->>'merchantShippingGroup',''),
        NULLIF(r->>'amazonPrice','')::numeric, NULLIF(r->>'minPrice','')::numeric,
        NULLIF(r->>'maxPrice','')::numeric, NULLIF(r->>'fixedPrice','')::numeric, NULLIF(r->>'mode',''),
        NULLIF(r->>'buyBoxSeller',''), NULLIF(r->>'buyBoxPrice','')::numeric,
        CASE WHEN r ? 'isOurBuybox' THEN (r->>'isOurBuybox')::boolean ELSE NULL END,
        NULLIF(r->>'offerCount','')::int, r->'strategy', r->'offers',
        NULLIF(r->>'esaguInserted','')::timestamptz, NULLIF(r->>'esaguUpdated','')::timestamptz,
        NULLIF(r->>'offersUpdated','')::timestamptz, NOW()
    FROM jsonb_array_elements(p_items) r
    LEFT JOIN amazon.asin_sku_map m
      ON m.marketplace_id = 'A1F83G8C2ARO7P' AND m.asin = NULLIF(r->>'asin','')
    ON CONFLICT (esagu_item_id) DO UPDATE SET
        esagu_sku = EXCLUDED.esagu_sku, asin = EXCLUDED.asin, catalogue_sku = EXCLUDED.catalogue_sku,
        title = EXCLUDED.title, fba = EXCLUDED.fba, prime = EXCLUDED.prime, quantity = EXCLUDED.quantity,
        merchant_shipping_group = EXCLUDED.merchant_shipping_group, amazon_price = EXCLUDED.amazon_price,
        min_price = EXCLUDED.min_price, max_price = EXCLUDED.max_price, fixed_price = EXCLUDED.fixed_price,
        mode = EXCLUDED.mode, buy_box_seller = EXCLUDED.buy_box_seller, buy_box_price = EXCLUDED.buy_box_price,
        is_our_buybox = EXCLUDED.is_our_buybox, offer_count = EXCLUDED.offer_count, strategy = EXCLUDED.strategy,
        offers = EXCLUDED.offers, esagu_inserted = EXCLUDED.esagu_inserted, esagu_updated = EXCLUDED.esagu_updated,
        offers_updated = EXCLUDED.offers_updated, synced_at = NOW();

    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE amazon.sync_run SET status = 'success', rows_upserted = v_n, finished_at = NOW()
    WHERE sync_run_id = v_run;
    RETURN jsonb_build_object('rows_upserted', v_n);
END;
$$;

-- service_role (the edge fn) only; anon locked out.
REVOKE ALL ON FUNCTION public.amazon_ingest_esagu_items(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amazon_ingest_esagu_items(JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- Frontend-facing buy-box gap view (curated read; internal staff).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_esagu_buybox AS
SELECT
    e.esagu_item_id, e.catalogue_sku, e.esagu_sku, e.asin, e.title,
    CASE WHEN e.fba THEN 'FBA' ELSE 'FBM' END AS fulfilment,
    e.quantity, e.amazon_price, e.min_price, e.max_price, e.mode,
    e.buy_box_price, e.buy_box_seller, e.is_our_buybox, e.offer_count,
    ROUND(e.amazon_price - e.buy_box_price, 2) AS price_vs_buybox,   -- +ve = we're above the box
    (e.buy_box_price IS NOT NULL AND e.min_price IS NOT NULL AND e.buy_box_price < e.min_price) AS box_below_our_floor,
    e.synced_at
FROM amazon.esagu_item e;

REVOKE ALL ON public.v_esagu_buybox FROM anon;
GRANT SELECT ON public.v_esagu_buybox TO authenticated;
