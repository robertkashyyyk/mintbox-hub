-- ============================================================================
-- 20260630250000_amazon_listings_barcode_map.sql
-- Add the BARCODE arm to the ASIN->SKU map for the pure-FBA residue (items with
-- no Mintsoft order to join on). The merchant-listings report gives, per ASIN,
-- the EAN/UPC we listed with; products_cache.barcode (158k) closes it.
--
--   amazon.listings              <- GET_MERCHANT_LISTINGS_ALL_DATA (asin/sku/ean)
--   amazon_ingest_listings()     thin upsert
--   amazon_rebuild_sku_map()     now: order_join -> barcode -> sku_normalize
-- ============================================================================

CREATE TABLE IF NOT EXISTS amazon.listings (
    marketplace_id  TEXT NOT NULL,
    seller_sku      TEXT NOT NULL,
    asin            TEXT,
    ean             TEXT,                  -- product-id when it's an EAN/UPC
    product_id_type TEXT,
    item_name       TEXT,
    quantity        INTEGER,
    status          TEXT,
    raw_id          BIGINT REFERENCES amazon.raw_report(raw_id) ON DELETE SET NULL,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (marketplace_id, seller_sku)
);
CREATE INDEX IF NOT EXISTS listings_asin_idx ON amazon.listings (marketplace_id, asin);
CREATE INDEX IF NOT EXISTS listings_ean_idx  ON amazon.listings (ean);

CREATE OR REPLACE FUNCTION public.amazon_ingest_listings(
    p_marketplace_id    TEXT,
    p_report_id         TEXT,
    p_document_id       TEXT,
    p_processing_status TEXT,
    p_rows              JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, amazon
AS $$
DECLARE
    v_conn UUID := amazon._ensure_connection(p_marketplace_id);
    v_run  UUID;
    v_raw  BIGINT;
    v_n    INTEGER := 0;
BEGIN
    INSERT INTO amazon.sync_run (connection_id, object, mode, status)
    VALUES (v_conn, 'listings', 'incremental', 'running') RETURNING sync_run_id INTO v_run;

    INSERT INTO amazon.raw_report
        (connection_id, sync_run_id, report_type, report_id, document_id, marketplace_ids,
         processing_status, payload, payload_bytes, fetched_at, parsed_at)
    VALUES
        (v_conn, v_run, 'GET_MERCHANT_LISTINGS_ALL_DATA', p_report_id, p_document_id, ARRAY[p_marketplace_id],
         p_processing_status, p_rows, length(p_rows::text), NOW(), NOW())
    ON CONFLICT (report_type, report_id) DO UPDATE
        SET payload = EXCLUDED.payload, processing_status = EXCLUDED.processing_status,
            sync_run_id = EXCLUDED.sync_run_id, parsed_at = NOW()
    RETURNING raw_id INTO v_raw;

    INSERT INTO amazon.listings (marketplace_id, seller_sku, asin, ean, product_id_type, item_name, quantity, status, raw_id)
    SELECT DISTINCT ON (r ->> 'seller_sku')
        p_marketplace_id, r ->> 'seller_sku', NULLIF(r ->> 'asin',''), NULLIF(r ->> 'ean',''),
        NULLIF(r ->> 'product_id_type',''), NULLIF(r ->> 'item_name',''),
        NULLIF(r ->> 'quantity','')::int, NULLIF(r ->> 'status',''), v_raw
    FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) AS r
    WHERE COALESCE(r ->> 'seller_sku','') <> ''
    ORDER BY r ->> 'seller_sku'
    ON CONFLICT (marketplace_id, seller_sku) DO UPDATE SET
        asin = EXCLUDED.asin, ean = EXCLUDED.ean, product_id_type = EXCLUDED.product_id_type,
        item_name = EXCLUDED.item_name, quantity = EXCLUDED.quantity, status = EXCLUDED.status,
        raw_id = EXCLUDED.raw_id, ingested_at = NOW();
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE amazon.sync_run SET status='success', rows_fetched=jsonb_array_length(COALESCE(p_rows,'[]'::jsonb)),
        rows_upserted=v_n, finished_at=NOW() WHERE sync_run_id = v_run;
    RETURN jsonb_build_object('sync_run_id', v_run, 'rows_upserted', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.amazon_ingest_listings(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_ingest_listings(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- Rebuild: order_join (ground truth) -> barcode (EAN) -> sku_normalize. --------
CREATE OR REPLACE FUNCTION public.amazon_rebuild_sku_map()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, amazon
SET statement_timeout = '120s'
AS $$
DECLARE v_report JSONB;
BEGIN
    DELETE FROM amazon.asin_sku_map WHERE NOT is_manual;

    -- 1. ORDER-JOIN ---------------------------------------------------------
    WITH amz_single AS (
        SELECT oi.amazon_order_id, MIN(oi.marketplace_id) AS marketplace_id,
               MIN(oi.asin) AS asin, MIN(oi.sku) AS amazon_sku
        FROM amazon.order_items oi WHERE oi.asin IS NOT NULL
        GROUP BY oi.amazon_order_id HAVING COUNT(DISTINCT oi.asin) = 1
    ),
    ml_single AS (
        SELECT ol.order_number, MIN(ol.sku) AS catalogue_sku
        FROM public.order_lines ol
        WHERE ol.channel = 'Amazon' AND ol.order_number IS NOT NULL AND ol.sku IS NOT NULL
        GROUP BY ol.order_number HAVING COUNT(DISTINCT ol.sku) = 1
    ),
    paired AS (
        SELECT a.marketplace_id, a.asin, m.catalogue_sku, MIN(a.amazon_sku) AS amazon_sku, COUNT(*) AS c
        FROM amz_single a JOIN ml_single m ON m.order_number = a.amazon_order_id
        GROUP BY a.marketplace_id, a.asin, m.catalogue_sku
    ),
    ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY marketplace_id, asin ORDER BY c DESC, catalogue_sku) AS rn FROM paired)
    INSERT INTO amazon.asin_sku_map (marketplace_id, asin, catalogue_sku, amazon_sku, match_method, confidence, evidence)
    SELECT r.marketplace_id, r.asin, r.catalogue_sku, r.amazon_sku, 'order_join', r.c, jsonb_build_object('matched_orders', r.c)
    FROM ranked r WHERE r.rn = 1
      AND NOT EXISTS (SELECT 1 FROM amazon.asin_sku_map m WHERE m.marketplace_id=r.marketplace_id AND m.asin=r.asin);

    -- 2. BARCODE: listing EAN -> products_cache.barcode ---------------------
    WITH lst AS (
        SELECT DISTINCT ON (marketplace_id, asin) marketplace_id, asin, ean, seller_sku
        FROM amazon.listings WHERE asin IS NOT NULL AND COALESCE(ean,'') <> ''
        ORDER BY marketplace_id, asin, seller_sku
    ),
    mb AS (
        SELECT l.marketplace_id, l.asin, l.seller_sku AS amazon_sku, pc.sku AS catalogue_sku
        FROM lst l
        JOIN public.products_cache pc ON pc.barcode = l.ean AND COALESCE(pc.discontinued,false) = false
    )
    INSERT INTO amazon.asin_sku_map (marketplace_id, asin, catalogue_sku, amazon_sku, match_method, confidence, evidence)
    SELECT DISTINCT ON (mb.marketplace_id, mb.asin)
        mb.marketplace_id, mb.asin, mb.catalogue_sku, mb.amazon_sku, 'barcode', NULL, jsonb_build_object('via','ean')
    FROM mb
    WHERE NOT EXISTS (SELECT 1 FROM amazon.asin_sku_map x WHERE x.marketplace_id=mb.marketplace_id AND x.asin=mb.asin)
    ORDER BY mb.marketplace_id, mb.asin, mb.catalogue_sku;

    -- 3. SKU-NORMALISE ------------------------------------------------------
    WITH pc AS MATERIALIZED (
        SELECT sku, upper(sku) AS usku FROM public.products_cache WHERE COALESCE(discontinued, false) = false
    ),
    asin_seller AS (
        SELECT marketplace_id, asin, amazon_sku, pri FROM (
            SELECT s.marketplace_id, s.asin, s.sku AS amazon_sku, 1 AS pri,
                   ROW_NUMBER() OVER (PARTITION BY s.marketplace_id, s.asin ORDER BY s.afn_fulfillable_quantity DESC, s.sku) AS rn
            FROM amazon.fba_inventory_snapshot s
            JOIN (SELECT marketplace_id, MAX(snapshot_date) d FROM amazon.fba_inventory_snapshot GROUP BY 1) l
              ON l.marketplace_id = s.marketplace_id AND l.d = s.snapshot_date
            WHERE s.asin IS NOT NULL AND s.sku IS NOT NULL
            UNION ALL
            SELECT oi.marketplace_id, oi.asin, oi.sku, 2,
                   ROW_NUMBER() OVER (PARTITION BY oi.marketplace_id, oi.asin ORDER BY oi.sku)
            FROM amazon.order_items oi WHERE oi.asin IS NOT NULL AND oi.sku IS NOT NULL
        ) z WHERE rn = 1
    ),
    best_seller AS (
        SELECT DISTINCT ON (marketplace_id, asin) marketplace_id, asin, amazon_sku
        FROM asin_seller ORDER BY marketplace_id, asin, pri
    ),
    matched AS (
        SELECT b.marketplace_id, b.asin, b.amazon_sku, pc.sku AS catalogue_sku
        FROM best_seller b JOIN pc ON pc.usku = amazon.normalize_amazon_sku(b.amazon_sku)
    )
    INSERT INTO amazon.asin_sku_map (marketplace_id, asin, catalogue_sku, amazon_sku, match_method, confidence, evidence)
    SELECT DISTINCT ON (m.marketplace_id, m.asin)
           m.marketplace_id, m.asin, m.catalogue_sku, m.amazon_sku, 'sku_normalized', NULL,
           jsonb_build_object('normalized', amazon.normalize_amazon_sku(m.amazon_sku))
    FROM matched m
    WHERE NOT EXISTS (SELECT 1 FROM amazon.asin_sku_map x WHERE x.marketplace_id=m.marketplace_id AND x.asin=m.asin)
    ORDER BY m.marketplace_id, m.asin, m.catalogue_sku;

    SELECT public.amazon_sku_map_coverage() INTO v_report;
    RETURN v_report;
END;
$$;
