-- ============================================================================
-- 20260625130000_amazon_ingest_sales_traffic.sql
-- Phase 1 ingest RPC for Amazon Sales & Traffic.
--
-- The `amazon-pull-sales-traffic` edge function does the SP-API dance (LWA →
-- createReport → poll → download → gunzip → JSON.parse) then hands the whole
-- parsed report payload to THIS function as a single jsonb. We keep all the
-- write logic in the DB (SECURITY DEFINER) so the edge function never needs
-- table grants and the amazon schema stays sealed off from PostgREST.
--
-- One call == one (marketplace, day) == one report == one sync_run. Idempotent:
-- re-running the same day overwrites the day's rows (ON CONFLICT) rather than
-- duplicating. Buy-box / conversion arrive 0-100 from Amazon, stored 0.0-1.0.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.amazon_ingest_sales_traffic(
    p_marketplace_id    TEXT,
    p_metric_date       DATE,
    p_report_id         TEXT,
    p_document_id       TEXT,
    p_processing_status TEXT,
    p_payload           JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, amazon
AS $$
DECLARE
    v_conn       UUID;
    v_run        UUID;
    v_raw        BIGINT;
    v_rows       INTEGER := 0;
    v_asins      JSONB := COALESCE(p_payload -> 'salesAndTrafficByAsin', '[]'::jsonb);
    v_day_start  TIMESTAMPTZ := (p_metric_date::text || 'T00:00:00Z')::timestamptz;
    v_day_end    TIMESTAMPTZ := (p_metric_date::text || 'T23:59:59Z')::timestamptz;
BEGIN
    -- 1. Connection (singleton, keyed by label) -------------------------------
    INSERT INTO amazon.connection (label, region, marketplace_ids, status,
                                   last_health_check_at, last_health_check_ok)
    VALUES ('partsdoc-eu', 'eu', ARRAY[p_marketplace_id], 'active', NOW(), TRUE)
    ON CONFLICT (label) DO UPDATE
        SET marketplace_ids = (
                SELECT ARRAY(SELECT DISTINCT unnest(amazon.connection.marketplace_ids || ARRAY[p_marketplace_id]))
            ),
            status               = 'active',
            last_health_check_at = NOW(),
            last_health_check_ok = TRUE,
            updated_at           = NOW()
    RETURNING connection_id INTO v_conn;

    -- 2. Sync run for this day ------------------------------------------------
    INSERT INTO amazon.sync_run (connection_id, object, mode, window_start, window_end, status)
    VALUES (v_conn, 'sales_traffic', 'manual', v_day_start, v_day_end, 'running')
    RETURNING sync_run_id INTO v_run;

    -- 3. Land the raw report verbatim -----------------------------------------
    INSERT INTO amazon.raw_report
        (connection_id, sync_run_id, report_type, report_id, document_id, marketplace_ids,
         data_start_time, data_end_time, processing_status, payload, payload_bytes, fetched_at)
    VALUES
        (v_conn, v_run, 'GET_SALES_AND_TRAFFIC_REPORT', p_report_id, p_document_id, ARRAY[p_marketplace_id],
         v_day_start, v_day_end, p_processing_status, p_payload, length(p_payload::text), NOW())
    ON CONFLICT (report_type, report_id) DO UPDATE
        SET payload           = EXCLUDED.payload,
            processing_status = EXCLUDED.processing_status,
            sync_run_id       = EXCLUDED.sync_run_id,
            document_id       = EXCLUDED.document_id,
            parsed_at         = NULL
    RETURNING raw_id INTO v_raw;

    -- 4. Upsert canonical per-ASIN rows ---------------------------------------
    INSERT INTO amazon.sales_traffic_daily (
        marketplace_id, metric_date, parent_asin, child_asin, sku, currency_code,
        ordered_product_sales, ordered_product_sales_b2b,
        units_ordered, units_ordered_b2b, total_order_items, total_order_items_b2b,
        sessions, sessions_b2b, browser_sessions, browser_sessions_b2b,
        mobile_app_sessions, mobile_app_sessions_b2b,
        page_views, page_views_b2b, browser_page_views, browser_page_views_b2b,
        mobile_app_page_views, mobile_app_page_views_b2b,
        buy_box_percentage, buy_box_percentage_b2b,
        unit_session_percentage, unit_session_percentage_b2b,
        raw_id, ingested_at, updated_at
    )
    SELECT
        p_marketplace_id,
        p_metric_date,
        COALESCE(e ->> 'parentAsin', ''),
        COALESCE(e ->> 'childAsin', ''),
        NULLIF(e ->> 'sku', ''),
        COALESCE(e #>> '{salesByAsin,orderedProductSales,currencyCode}', 'GBP'),
        COALESCE((e #>> '{salesByAsin,orderedProductSales,amount}')::numeric, 0),
        COALESCE((e #>> '{salesByAsin,orderedProductSalesB2B,amount}')::numeric, 0),
        COALESCE((e #>> '{salesByAsin,unitsOrdered}')::int, 0),
        COALESCE((e #>> '{salesByAsin,unitsOrderedB2B}')::int, 0),
        COALESCE((e #>> '{salesByAsin,totalOrderItems}')::int, 0),
        COALESCE((e #>> '{salesByAsin,totalOrderItemsB2B}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,sessions}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,sessionsB2B}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,browserSessions}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,browserSessionsB2B}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,mobileAppSessions}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,mobileAppSessionsB2B}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,pageViews}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,pageViewsB2B}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,browserPageViews}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,browserPageViewsB2B}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,mobileAppPageViews}')::int, 0),
        COALESCE((e #>> '{trafficByAsin,mobileAppPageViewsB2B}')::int, 0),
        CASE WHEN e #>> '{trafficByAsin,buyBoxPercentage}'        IS NOT NULL THEN (e #>> '{trafficByAsin,buyBoxPercentage}')::numeric        / 100 END,
        CASE WHEN e #>> '{trafficByAsin,buyBoxPercentageB2B}'     IS NOT NULL THEN (e #>> '{trafficByAsin,buyBoxPercentageB2B}')::numeric     / 100 END,
        CASE WHEN e #>> '{trafficByAsin,unitSessionPercentage}'   IS NOT NULL THEN (e #>> '{trafficByAsin,unitSessionPercentage}')::numeric   / 100 END,
        CASE WHEN e #>> '{trafficByAsin,unitSessionPercentageB2B}' IS NOT NULL THEN (e #>> '{trafficByAsin,unitSessionPercentageB2B}')::numeric / 100 END,
        v_raw, NOW(), NOW()
    FROM jsonb_array_elements(v_asins) AS e
    WHERE COALESCE(e ->> 'childAsin', '') <> ''
    ON CONFLICT (marketplace_id, metric_date, child_asin) DO UPDATE SET
        parent_asin                 = EXCLUDED.parent_asin,
        sku                         = EXCLUDED.sku,
        currency_code               = EXCLUDED.currency_code,
        ordered_product_sales       = EXCLUDED.ordered_product_sales,
        ordered_product_sales_b2b   = EXCLUDED.ordered_product_sales_b2b,
        units_ordered               = EXCLUDED.units_ordered,
        units_ordered_b2b           = EXCLUDED.units_ordered_b2b,
        total_order_items           = EXCLUDED.total_order_items,
        total_order_items_b2b       = EXCLUDED.total_order_items_b2b,
        sessions                    = EXCLUDED.sessions,
        sessions_b2b                = EXCLUDED.sessions_b2b,
        browser_sessions            = EXCLUDED.browser_sessions,
        browser_sessions_b2b        = EXCLUDED.browser_sessions_b2b,
        mobile_app_sessions         = EXCLUDED.mobile_app_sessions,
        mobile_app_sessions_b2b     = EXCLUDED.mobile_app_sessions_b2b,
        page_views                  = EXCLUDED.page_views,
        page_views_b2b              = EXCLUDED.page_views_b2b,
        browser_page_views          = EXCLUDED.browser_page_views,
        browser_page_views_b2b      = EXCLUDED.browser_page_views_b2b,
        mobile_app_page_views       = EXCLUDED.mobile_app_page_views,
        mobile_app_page_views_b2b   = EXCLUDED.mobile_app_page_views_b2b,
        buy_box_percentage          = EXCLUDED.buy_box_percentage,
        buy_box_percentage_b2b      = EXCLUDED.buy_box_percentage_b2b,
        unit_session_percentage     = EXCLUDED.unit_session_percentage,
        unit_session_percentage_b2b = EXCLUDED.unit_session_percentage_b2b,
        raw_id                      = EXCLUDED.raw_id,
        updated_at                  = NOW();

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- 5. Close out ------------------------------------------------------------
    UPDATE amazon.raw_report SET parsed_at = NOW() WHERE raw_id = v_raw;
    UPDATE amazon.sync_run
       SET status        = 'success',
           rows_fetched  = jsonb_array_length(v_asins),
           rows_upserted = v_rows,
           finished_at   = NOW()
     WHERE sync_run_id = v_run;

    RETURN jsonb_build_object(
        'connection_id', v_conn,
        'sync_run_id',   v_run,
        'raw_id',        v_raw,
        'metric_date',   p_metric_date,
        'asin_rows',     jsonb_array_length(v_asins),
        'rows_upserted', v_rows
    );
END;
$$;

-- Service-role only — the edge function calls this with the service key. No
-- anon / authenticated execute (they can't reach the amazon schema anyway).
REVOKE ALL ON FUNCTION public.amazon_ingest_sales_traffic(TEXT, DATE, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_ingest_sales_traffic(TEXT, DATE, TEXT, TEXT, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.amazon_ingest_sales_traffic(TEXT, DATE, TEXT, TEXT, TEXT, JSONB) IS
'Phase 1 Amazon Sales & Traffic ingest. Called by the amazon-pull-sales-traffic edge function with one day''s parsed S&T report. Upserts amazon.sales_traffic_daily, lands raw in amazon.raw_report, tracks a sync_run. Idempotent per (marketplace, day). service_role only.';
