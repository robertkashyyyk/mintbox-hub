-- ============================================================================
-- 20260630120000_amazon_phase3_inventory.sql
-- Phase 3 ingest RPCs: FBA inventory snapshot, reserved inventory (3 buckets,
-- never summed), and the inventory ledger detail.
--
-- Same pattern as Phases 1-2: the edge function fetches the Reports-API TSV,
-- parses + maps it, and passes clean rows here. The snapshot is the one that
-- matters most — it's the only missing input to the already-built
-- public.v_fba_replenishment view (on-hand + inbound). service_role only.
--
--   amazon_ingest_fba_inventory()       -> amazon.fba_inventory_snapshot
--   amazon_ingest_reserved_inventory()  -> amazon.fba_reserved_inventory
--   amazon_ingest_inventory_ledger()    -> amazon.inventory_ledger_detail
-- ============================================================================

-- FBA INVENTORY SNAPSHOT (GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA) ------------
CREATE OR REPLACE FUNCTION public.amazon_ingest_fba_inventory(
    p_marketplace_id    TEXT,
    p_snapshot_date     DATE,
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
    INSERT INTO amazon.sync_run (connection_id, object, mode, window_start, window_end, status)
    VALUES (v_conn, 'fba_inventory', 'incremental', p_snapshot_date::timestamptz, p_snapshot_date::timestamptz, 'running')
    RETURNING sync_run_id INTO v_run;

    INSERT INTO amazon.raw_report
        (connection_id, sync_run_id, report_type, report_id, document_id, marketplace_ids,
         data_start_time, data_end_time, processing_status, payload, payload_bytes, fetched_at, parsed_at)
    VALUES
        (v_conn, v_run, 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA', p_report_id, p_document_id,
         ARRAY[p_marketplace_id], p_snapshot_date::timestamptz, p_snapshot_date::timestamptz, p_processing_status,
         p_rows, length(p_rows::text), NOW(), NOW())
    ON CONFLICT (report_type, report_id) DO UPDATE
        SET payload = EXCLUDED.payload, processing_status = EXCLUDED.processing_status,
            sync_run_id = EXCLUDED.sync_run_id, parsed_at = NOW()
    RETURNING raw_id INTO v_raw;

    INSERT INTO amazon.fba_inventory_snapshot (
        snapshot_date, marketplace_id, sku, fnsku, asin, product_name, afn_listing_exists,
        afn_warehouse_quantity, afn_fulfillable_quantity, afn_unsellable_quantity, afn_reserved_quantity,
        afn_total_quantity, afn_inbound_working_quantity, afn_inbound_shipped_quantity,
        afn_inbound_receiving_quantity, raw_id)
    SELECT DISTINCT ON (r ->> 'sku')
        p_snapshot_date, p_marketplace_id,
        r ->> 'sku', NULLIF(r ->> 'fnsku',''), NULLIF(r ->> 'asin',''), NULLIF(r ->> 'product_name',''),
        CASE WHEN lower(COALESCE(r ->> 'afn_listing_exists','')) IN ('yes','true','y') THEN TRUE
             WHEN lower(COALESCE(r ->> 'afn_listing_exists','')) IN ('no','false','n') THEN FALSE END,
        COALESCE((r ->> 'afn_warehouse_quantity')::int, 0),
        COALESCE((r ->> 'afn_fulfillable_quantity')::int, 0),
        COALESCE((r ->> 'afn_unsellable_quantity')::int, 0),
        COALESCE((r ->> 'afn_reserved_quantity')::int, 0),
        COALESCE((r ->> 'afn_total_quantity')::int, 0),
        COALESCE((r ->> 'afn_inbound_working_quantity')::int, 0),
        COALESCE((r ->> 'afn_inbound_shipped_quantity')::int, 0),
        COALESCE((r ->> 'afn_inbound_receiving_quantity')::int, 0),
        v_raw
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
    WHERE COALESCE(r ->> 'sku','') <> ''
    ORDER BY r ->> 'sku'
    ON CONFLICT (snapshot_date, marketplace_id, sku) DO UPDATE SET
        fnsku = EXCLUDED.fnsku, asin = EXCLUDED.asin, product_name = EXCLUDED.product_name,
        afn_listing_exists = EXCLUDED.afn_listing_exists,
        afn_warehouse_quantity = EXCLUDED.afn_warehouse_quantity,
        afn_fulfillable_quantity = EXCLUDED.afn_fulfillable_quantity,
        afn_unsellable_quantity = EXCLUDED.afn_unsellable_quantity,
        afn_reserved_quantity = EXCLUDED.afn_reserved_quantity,
        afn_total_quantity = EXCLUDED.afn_total_quantity,
        afn_inbound_working_quantity = EXCLUDED.afn_inbound_working_quantity,
        afn_inbound_shipped_quantity = EXCLUDED.afn_inbound_shipped_quantity,
        afn_inbound_receiving_quantity = EXCLUDED.afn_inbound_receiving_quantity,
        raw_id = EXCLUDED.raw_id, ingested_at = NOW();
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE amazon.sync_run SET status='success', rows_fetched=jsonb_array_length(COALESCE(p_rows,'[]'::jsonb)),
        rows_upserted=v_n, finished_at=NOW() WHERE sync_run_id = v_run;
    RETURN jsonb_build_object('sync_run_id', v_run, 'raw_id', v_raw, 'rows_upserted', v_n);
END;
$$;

-- RESERVED INVENTORY (GET_RESERVED_INVENTORY_DATA) — 3 buckets, never summed ---
CREATE OR REPLACE FUNCTION public.amazon_ingest_reserved_inventory(
    p_marketplace_id    TEXT,
    p_snapshot_at       TIMESTAMPTZ,
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
    INSERT INTO amazon.sync_run (connection_id, object, mode, window_start, window_end, status)
    VALUES (v_conn, 'fba_reserved', 'incremental', p_snapshot_at, p_snapshot_at, 'running')
    RETURNING sync_run_id INTO v_run;

    INSERT INTO amazon.raw_report
        (connection_id, sync_run_id, report_type, report_id, document_id, marketplace_ids,
         data_start_time, data_end_time, processing_status, payload, payload_bytes, fetched_at, parsed_at)
    VALUES
        (v_conn, v_run, 'GET_RESERVED_INVENTORY_DATA', p_report_id, p_document_id, ARRAY[p_marketplace_id],
         p_snapshot_at, p_snapshot_at, p_processing_status, p_rows, length(p_rows::text), NOW(), NOW())
    ON CONFLICT (report_type, report_id) DO UPDATE
        SET payload = EXCLUDED.payload, processing_status = EXCLUDED.processing_status,
            sync_run_id = EXCLUDED.sync_run_id, parsed_at = NOW()
    RETURNING raw_id INTO v_raw;

    INSERT INTO amazon.fba_reserved_inventory (
        snapshot_at, marketplace_id, sku, fnsku, asin,
        reserved_qty_customer_orders, reserved_qty_fc_transfers, reserved_qty_fc_processing, raw_id)
    SELECT DISTINCT ON (r ->> 'sku')
        p_snapshot_at, p_marketplace_id, r ->> 'sku', NULLIF(r ->> 'fnsku',''), NULLIF(r ->> 'asin',''),
        COALESCE((r ->> 'reserved_qty_customer_orders')::int, 0),
        COALESCE((r ->> 'reserved_qty_fc_transfers')::int, 0),
        COALESCE((r ->> 'reserved_qty_fc_processing')::int, 0),
        v_raw
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
    WHERE COALESCE(r ->> 'sku','') <> ''
    ORDER BY r ->> 'sku'
    ON CONFLICT (snapshot_at, marketplace_id, sku) DO UPDATE SET
        fnsku = EXCLUDED.fnsku, asin = EXCLUDED.asin,
        reserved_qty_customer_orders = EXCLUDED.reserved_qty_customer_orders,
        reserved_qty_fc_transfers = EXCLUDED.reserved_qty_fc_transfers,
        reserved_qty_fc_processing = EXCLUDED.reserved_qty_fc_processing,
        raw_id = EXCLUDED.raw_id, ingested_at = NOW();
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE amazon.sync_run SET status='success', rows_fetched=jsonb_array_length(COALESCE(p_rows,'[]'::jsonb)),
        rows_upserted=v_n, finished_at=NOW() WHERE sync_run_id = v_run;
    RETURN jsonb_build_object('sync_run_id', v_run, 'raw_id', v_raw, 'rows_upserted', v_n);
END;
$$;

-- INVENTORY LEDGER DETAIL (GET_LEDGER_DETAIL_VIEW_DATA) ----------------------
CREATE OR REPLACE FUNCTION public.amazon_ingest_inventory_ledger(
    p_marketplace_id    TEXT,
    p_window_start      TIMESTAMPTZ,
    p_window_end        TIMESTAMPTZ,
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
    INSERT INTO amazon.sync_run (connection_id, object, mode, window_start, window_end, status)
    VALUES (v_conn, 'inventory_ledger', 'backfill', p_window_start, p_window_end, 'running')
    RETURNING sync_run_id INTO v_run;

    INSERT INTO amazon.raw_report
        (connection_id, sync_run_id, report_type, report_id, document_id, marketplace_ids,
         data_start_time, data_end_time, processing_status, payload, payload_bytes, fetched_at, parsed_at)
    VALUES
        (v_conn, v_run, 'GET_LEDGER_DETAIL_VIEW_DATA', p_report_id, p_document_id, ARRAY[p_marketplace_id],
         p_window_start, p_window_end, p_processing_status, p_rows, length(p_rows::text), NOW(), NOW())
    ON CONFLICT (report_type, report_id) DO UPDATE
        SET payload = EXCLUDED.payload, processing_status = EXCLUDED.processing_status,
            sync_run_id = EXCLUDED.sync_run_id, parsed_at = NOW()
    RETURNING raw_id INTO v_raw;

    WITH src AS (
        SELECT
            (r ->> 'event_date')::date AS event_date,
            NULLIF(r ->> 'fnsku','') AS fnsku, NULLIF(r ->> 'asin','') AS asin,
            r ->> 'sku' AS sku, NULLIF(r ->> 'title','') AS title,
            r ->> 'event_type' AS event_type,
            COALESCE(NULLIF(r ->> 'reference_id',''), 'na') AS reference_id,
            COALESCE((r ->> 'quantity')::int, 0) AS quantity,
            NULLIF(r ->> 'fulfillment_center','') AS fulfillment_center,
            NULLIF(r ->> 'disposition','') AS disposition,
            NULLIF(upper(r ->> 'country'),'') AS country
        FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r
        WHERE COALESCE(r ->> 'sku','') <> '' AND COALESCE(r ->> 'event_type','') <> ''
          AND COALESCE(r ->> 'event_date','') <> ''
    )
    INSERT INTO amazon.inventory_ledger_detail (
        event_date, marketplace_id, fnsku, asin, sku, title, event_type, reference_id,
        quantity, fulfillment_center, disposition, country, raw_id)
    SELECT DISTINCT ON (event_date, sku, event_type, reference_id)
        event_date, p_marketplace_id, fnsku, asin, sku, title, event_type, reference_id,
        quantity, fulfillment_center, disposition, country, v_raw
    FROM src
    ORDER BY event_date, sku, event_type, reference_id
    ON CONFLICT (event_date, marketplace_id, sku, event_type, reference_id) DO UPDATE SET
        fnsku = EXCLUDED.fnsku, asin = EXCLUDED.asin, title = EXCLUDED.title,
        quantity = EXCLUDED.quantity, fulfillment_center = EXCLUDED.fulfillment_center,
        disposition = EXCLUDED.disposition, country = EXCLUDED.country, raw_id = EXCLUDED.raw_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE amazon.sync_run SET status='success', rows_fetched=jsonb_array_length(COALESCE(p_rows,'[]'::jsonb)),
        rows_upserted=v_n, finished_at=NOW() WHERE sync_run_id = v_run;
    RETURN jsonb_build_object('sync_run_id', v_run, 'raw_id', v_raw, 'rows_upserted', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.amazon_ingest_fba_inventory(TEXT, DATE, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_ingest_fba_inventory(TEXT, DATE, TEXT, TEXT, TEXT, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.amazon_ingest_reserved_inventory(TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_ingest_reserved_inventory(TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.amazon_ingest_inventory_ledger(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_ingest_inventory_ledger(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB) TO service_role;
