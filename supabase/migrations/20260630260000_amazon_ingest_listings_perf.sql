-- ============================================================================
-- 20260630260000_amazon_ingest_listings_perf.sql
-- amazon_ingest_listings timed out on ~70k listings: it serialised the whole
-- 70k-row array into raw_report.payload (pointless ~10MB jsonb) and had no
-- raised statement_timeout. Store only a row-count summary + SET timeout.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.amazon_ingest_listings(
    p_marketplace_id    TEXT,
    p_report_id         TEXT,
    p_document_id       TEXT,
    p_processing_status TEXT,
    p_rows              JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, amazon
SET statement_timeout = '180s'
AS $$
DECLARE
    v_conn UUID := amazon._ensure_connection(p_marketplace_id);
    v_run  UUID;
    v_raw  BIGINT;
    v_n    INTEGER := 0;
BEGIN
    INSERT INTO amazon.sync_run (connection_id, object, mode, status)
    VALUES (v_conn, 'listings', 'incremental', 'running') RETURNING sync_run_id INTO v_run;

    -- Store only a small summary, not the full 70k-row payload.
    INSERT INTO amazon.raw_report
        (connection_id, sync_run_id, report_type, report_id, document_id, marketplace_ids,
         processing_status, payload, payload_bytes, fetched_at, parsed_at)
    VALUES
        (v_conn, v_run, 'GET_MERCHANT_LISTINGS_ALL_DATA', p_report_id, p_document_id, ARRAY[p_marketplace_id],
         p_processing_status, jsonb_build_object('row_count', jsonb_array_length(COALESCE(p_rows,'[]'::jsonb))),
         length(p_rows::text), NOW(), NOW())
    ON CONFLICT (report_type, report_id) DO UPDATE
        SET processing_status = EXCLUDED.processing_status, sync_run_id = EXCLUDED.sync_run_id,
            payload = EXCLUDED.payload, payload_bytes = EXCLUDED.payload_bytes, parsed_at = NOW()
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
