-- ============================================================================
-- 20260625160000_amazon_phase2_orders_finances.sql
-- Phase 2 ingest RPCs: Orders (order-line detail) + Finances (fees / margin).
--
-- Same shape as Phase 1: the edge function does the SP-API dance AND the gnarly
-- parsing (TSV for the all-orders flat file; deeply-nested JSON for
-- listFinancialEvents), then hands clean, already-mapped rows to these thin
-- SECURITY DEFINER upserts. Keeps the Amazon-format quirks in testable TS and
-- the DB writes simple + idempotent. service_role only.
--
--   amazon_ingest_orders()            -> amazon.orders + amazon.order_items
--   amazon_ingest_financial_events()  -> amazon.financial_events (+ raw_event)
-- ============================================================================

-- Shared: ensure the singleton connection row, return its id. ------------------
CREATE OR REPLACE FUNCTION amazon._ensure_connection(p_marketplace_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_conn UUID;
BEGIN
    INSERT INTO amazon.connection (label, region, marketplace_ids, status,
                                   last_health_check_at, last_health_check_ok)
    VALUES ('partsdoc-eu', 'eu', ARRAY[p_marketplace_id], 'active', NOW(), TRUE)
    ON CONFLICT (label) DO UPDATE
        SET marketplace_ids = (
                SELECT ARRAY(SELECT DISTINCT unnest(amazon.connection.marketplace_ids || ARRAY[p_marketplace_id]))
            ),
            status = 'active', last_health_check_at = NOW(), last_health_check_ok = TRUE, updated_at = NOW()
    RETURNING connection_id INTO v_conn;
    RETURN v_conn;
END;
$$;

-- ============================================================================
-- ORDERS — one all-orders flat-file report (a window) -> orders + order_items.
-- The edge fn parses the TSV and passes two clean arrays. order_item_id is
-- synthesised from sku (the flat file carries no item id; one line per
-- order×sku for FBA), so re-pulls overwrite rather than duplicate.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.amazon_ingest_orders(
    p_marketplace_id    TEXT,
    p_window_start      TIMESTAMPTZ,
    p_window_end        TIMESTAMPTZ,
    p_report_id         TEXT,
    p_document_id       TEXT,
    p_processing_status TEXT,
    p_orders            JSONB,   -- array of order objects (deduped by the edge fn)
    p_items             JSONB    -- array of order-line objects
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, amazon
AS $$
DECLARE
    v_conn   UUID := amazon._ensure_connection(p_marketplace_id);
    v_run    UUID;
    v_raw    BIGINT;
    v_orders INTEGER := 0;
    v_items  INTEGER := 0;
BEGIN
    INSERT INTO amazon.sync_run (connection_id, object, mode, window_start, window_end, status)
    VALUES (v_conn, 'orders', 'backfill', p_window_start, p_window_end, 'running')
    RETURNING sync_run_id INTO v_run;

    INSERT INTO amazon.raw_report
        (connection_id, sync_run_id, report_type, report_id, document_id, marketplace_ids,
         data_start_time, data_end_time, processing_status, payload, payload_bytes, fetched_at, parsed_at)
    VALUES
        (v_conn, v_run, 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL', p_report_id, p_document_id,
         ARRAY[p_marketplace_id], p_window_start, p_window_end, p_processing_status,
         jsonb_build_object('orders', p_orders, 'items', p_items),
         length(p_orders::text) + length(p_items::text), NOW(), NOW())
    ON CONFLICT (report_type, report_id) DO UPDATE
        SET payload = EXCLUDED.payload, processing_status = EXCLUDED.processing_status,
            sync_run_id = EXCLUDED.sync_run_id, parsed_at = NOW()
    RETURNING raw_id INTO v_raw;

    -- Orders -----------------------------------------------------------------
    INSERT INTO amazon.orders (
        marketplace_id, amazon_order_id, merchant_order_id, purchase_date, last_updated_date,
        order_status, fulfillment_channel, sales_channel, ship_service_level, is_business_order,
        ship_country, ship_postal_code, raw_id, updated_at)
    SELECT
        p_marketplace_id,
        o ->> 'amazon_order_id',
        NULLIF(o ->> 'merchant_order_id', ''),
        NULLIF(o ->> 'purchase_date', '')::timestamptz,
        NULLIF(o ->> 'last_updated_date', '')::timestamptz,
        NULLIF(o ->> 'order_status', ''),
        NULLIF(o ->> 'fulfillment_channel', ''),
        NULLIF(o ->> 'sales_channel', ''),
        NULLIF(o ->> 'ship_service_level', ''),
        CASE WHEN lower(COALESCE(o ->> 'is_business_order','')) IN ('true','1','yes') THEN TRUE
             WHEN lower(COALESCE(o ->> 'is_business_order','')) IN ('false','0','no') THEN FALSE END,
        NULLIF(upper(o ->> 'ship_country'), ''),
        NULLIF(o ->> 'ship_postal_code', ''),
        v_raw, NOW()
    FROM jsonb_array_elements(COALESCE(p_orders, '[]'::jsonb)) AS o
    WHERE COALESCE(o ->> 'amazon_order_id', '') <> ''
    ON CONFLICT (marketplace_id, amazon_order_id) DO UPDATE SET
        merchant_order_id   = EXCLUDED.merchant_order_id,
        purchase_date       = EXCLUDED.purchase_date,
        last_updated_date   = EXCLUDED.last_updated_date,
        order_status        = EXCLUDED.order_status,
        fulfillment_channel = EXCLUDED.fulfillment_channel,
        sales_channel       = EXCLUDED.sales_channel,
        ship_service_level  = EXCLUDED.ship_service_level,
        is_business_order   = EXCLUDED.is_business_order,
        ship_country        = EXCLUDED.ship_country,
        ship_postal_code    = EXCLUDED.ship_postal_code,
        raw_id              = EXCLUDED.raw_id,
        updated_at          = NOW();
    GET DIAGNOSTICS v_orders = ROW_COUNT;

    -- Order items ------------------------------------------------------------
    -- Compute the synthesised order_item_id first, then DISTINCT ON it so a
    -- repeated (order, item_id) within one batch can't trip ON CONFLICT DO UPDATE.
    WITH src AS (
        SELECT
            i ->> 'amazon_order_id' AS amazon_order_id,
            COALESCE(NULLIF(i ->> 'order_item_id', ''), NULLIF(i ->> 'sku', ''), 'line') AS order_item_id,
            NULLIF(i ->> 'asin', '') AS asin,
            NULLIF(i ->> 'sku', '') AS sku,
            NULLIF(i ->> 'product_name', '') AS product_name,
            COALESCE((i ->> 'quantity')::int, 0) AS quantity,
            COALESCE((i ->> 'quantity_shipped')::int, 0) AS quantity_shipped,
            NULLIF(i ->> 'item_price', '')::numeric AS item_price,
            NULLIF(i ->> 'item_tax', '')::numeric AS item_tax,
            NULLIF(i ->> 'shipping_price', '')::numeric AS shipping_price,
            NULLIF(i ->> 'item_promotion_discount', '')::numeric AS item_promotion_discount,
            NULLIF(i ->> 'currency_code', '') AS currency_code
        FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS i
        WHERE COALESCE(i ->> 'amazon_order_id', '') <> ''
    )
    INSERT INTO amazon.order_items (
        amazon_order_id, order_item_id, marketplace_id, asin, sku, product_name,
        quantity, quantity_shipped, item_price, item_tax, shipping_price,
        item_promotion_discount, currency_code, raw_id)
    SELECT DISTINCT ON (amazon_order_id, order_item_id)
        amazon_order_id, order_item_id, p_marketplace_id, asin, sku, product_name,
        quantity, quantity_shipped, item_price, item_tax, shipping_price,
        item_promotion_discount, currency_code, v_raw
    FROM src
    ORDER BY amazon_order_id, order_item_id
    ON CONFLICT (amazon_order_id, order_item_id) DO UPDATE SET
        asin                    = EXCLUDED.asin,
        sku                     = EXCLUDED.sku,
        product_name            = EXCLUDED.product_name,
        quantity                = EXCLUDED.quantity,
        quantity_shipped        = EXCLUDED.quantity_shipped,
        item_price              = EXCLUDED.item_price,
        item_tax                = EXCLUDED.item_tax,
        shipping_price          = EXCLUDED.shipping_price,
        item_promotion_discount = EXCLUDED.item_promotion_discount,
        currency_code           = EXCLUDED.currency_code,
        raw_id                  = EXCLUDED.raw_id;
    GET DIAGNOSTICS v_items = ROW_COUNT;

    UPDATE amazon.sync_run
       SET status = 'success', rows_fetched = jsonb_array_length(COALESCE(p_items,'[]'::jsonb)),
           rows_upserted = v_orders + v_items, finished_at = NOW()
     WHERE sync_run_id = v_run;

    RETURN jsonb_build_object('sync_run_id', v_run, 'raw_id', v_raw,
        'orders_upserted', v_orders, 'items_upserted', v_items);
END;
$$;

-- ============================================================================
-- FINANCES — one page of listFinancialEvents, already flattened by the edge fn
-- into normalised event rows. amount = abs(original); direction from its sign
-- (fees arrive negative). Idempotent on (marketplace, type, posted_date, hash).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.amazon_ingest_financial_events(
    p_marketplace_id TEXT,
    p_window_start   TIMESTAMPTZ,
    p_window_end     TIMESTAMPTZ,
    p_request_params JSONB,
    p_next_token     TEXT,
    p_raw_payload    JSONB,
    p_events         JSONB    -- array of {event_type, event_subtype, posted_date,
                              -- amazon_order_id, sku, asin, original_amount,
                              -- currency_code, fee_description, event_hash}
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, amazon
AS $$
DECLARE
    v_conn     UUID := amazon._ensure_connection(p_marketplace_id);
    v_run      UUID;
    v_raw      BIGINT;
    v_inserted INTEGER := 0;
BEGIN
    INSERT INTO amazon.sync_run (connection_id, object, mode, window_start, window_end, status, finished_at)
    VALUES (v_conn, 'financial_events', 'backfill', p_window_start, p_window_end, 'success', NOW())
    RETURNING sync_run_id INTO v_run;

    INSERT INTO amazon.raw_event (connection_id, sync_run_id, endpoint, request_params,
                                  response_payload, next_token, parsed_at)
    VALUES (v_conn, v_run, 'listFinancialEvents', p_request_params, p_raw_payload, p_next_token, NOW())
    RETURNING raw_id INTO v_raw;

    INSERT INTO amazon.financial_events (
        marketplace_id, event_type, event_subtype, posted_date, amazon_order_id, sku, asin,
        amount, direction, original_amount, currency_code, fee_description, event_hash, raw_id)
    SELECT
        p_marketplace_id,
        e ->> 'event_type',
        NULLIF(e ->> 'event_subtype', ''),
        (e ->> 'posted_date')::timestamptz,
        NULLIF(e ->> 'amazon_order_id', ''),
        NULLIF(e ->> 'sku', ''),
        NULLIF(e ->> 'asin', ''),
        abs((e ->> 'original_amount')::numeric),
        CASE WHEN (e ->> 'original_amount')::numeric < 0 THEN 'debit' ELSE 'credit' END,
        (e ->> 'original_amount')::numeric,
        COALESCE(NULLIF(e ->> 'currency_code', ''), 'GBP'),
        NULLIF(e ->> 'fee_description', ''),
        e ->> 'event_hash',
        v_raw
    FROM jsonb_array_elements(COALESCE(p_events, '[]'::jsonb)) AS e
    WHERE COALESCE(e ->> 'event_hash', '') <> ''
      AND (e ->> 'original_amount') IS NOT NULL
    ON CONFLICT (marketplace_id, event_type, posted_date, event_hash) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    UPDATE amazon.sync_run
       SET rows_fetched = jsonb_array_length(COALESCE(p_events,'[]'::jsonb)), rows_upserted = v_inserted
     WHERE sync_run_id = v_run;

    RETURN jsonb_build_object('sync_run_id', v_run, 'raw_id', v_raw,
        'events_seen', jsonb_array_length(COALESCE(p_events,'[]'::jsonb)), 'events_inserted', v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.amazon_ingest_orders(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_ingest_orders(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.amazon_ingest_financial_events(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_ingest_financial_events(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT, JSONB, JSONB) TO service_role;

COMMENT ON FUNCTION public.amazon_ingest_orders(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, JSONB) IS
'Phase 2 Amazon Orders ingest. Edge fn parses the all-orders flat file (TSV) and passes clean order + item arrays. Upserts amazon.orders + amazon.order_items. service_role only.';
COMMENT ON FUNCTION public.amazon_ingest_financial_events(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT, JSONB, JSONB) IS
'Phase 2 Amazon Finances ingest. Edge fn flattens one listFinancialEvents page into normalised event rows (fees negative). Stores abs amount + direction; idempotent on (marketplace,type,posted_date,hash). service_role only.';
