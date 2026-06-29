-- ============================================================================
-- 20260630180000_amazon_sku_map_perf_fix.sql
-- Fix: best_seller orders by `pri`, but asin_seller's outer projection dropped
-- it -> "column pri does not exist". Carry pri through. (Only change vs prior.)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.amazon_rebuild_sku_map()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, amazon
SET statement_timeout = '120s'
AS $$
DECLARE v_report JSONB;
BEGIN
    DELETE FROM amazon.asin_sku_map WHERE NOT is_manual;

    WITH amz_single AS (
        SELECT oi.amazon_order_id,
               MIN(oi.marketplace_id) AS marketplace_id,
               MIN(oi.asin)           AS asin,
               MIN(oi.sku)            AS amazon_sku
        FROM amazon.order_items oi
        WHERE oi.asin IS NOT NULL
        GROUP BY oi.amazon_order_id
        HAVING COUNT(DISTINCT oi.asin) = 1
    ),
    ml_single AS (
        SELECT ol.order_number, MIN(ol.sku) AS catalogue_sku
        FROM public.order_lines ol
        WHERE ol.channel = 'Amazon' AND ol.order_number IS NOT NULL AND ol.sku IS NOT NULL
        GROUP BY ol.order_number
        HAVING COUNT(DISTINCT ol.sku) = 1
    ),
    paired AS (
        SELECT a.marketplace_id, a.asin, m.catalogue_sku, MIN(a.amazon_sku) AS amazon_sku, COUNT(*) AS c
        FROM amz_single a
        JOIN ml_single m ON m.order_number = a.amazon_order_id
        GROUP BY a.marketplace_id, a.asin, m.catalogue_sku
    ),
    ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY marketplace_id, asin ORDER BY c DESC, catalogue_sku) AS rn
        FROM paired
    )
    INSERT INTO amazon.asin_sku_map (marketplace_id, asin, catalogue_sku, amazon_sku, match_method, confidence, evidence)
    SELECT r.marketplace_id, r.asin, r.catalogue_sku, r.amazon_sku, 'order_join', r.c,
           jsonb_build_object('matched_orders', r.c)
    FROM ranked r
    WHERE r.rn = 1
      AND NOT EXISTS (SELECT 1 FROM amazon.asin_sku_map m
                      WHERE m.marketplace_id = r.marketplace_id AND m.asin = r.asin);

    WITH pc AS MATERIALIZED (
        SELECT sku, upper(sku) AS usku
        FROM public.products_cache
        WHERE COALESCE(discontinued, false) = false
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
        FROM asin_seller
        ORDER BY marketplace_id, asin, pri
    ),
    matched AS (
        SELECT b.marketplace_id, b.asin, b.amazon_sku, pc.sku AS catalogue_sku
        FROM best_seller b
        JOIN pc ON pc.usku = amazon.normalize_amazon_sku(b.amazon_sku)
    )
    INSERT INTO amazon.asin_sku_map (marketplace_id, asin, catalogue_sku, amazon_sku, match_method, confidence, evidence)
    SELECT DISTINCT ON (m.marketplace_id, m.asin)
           m.marketplace_id, m.asin, m.catalogue_sku, m.amazon_sku, 'sku_normalized', NULL,
           jsonb_build_object('normalized', amazon.normalize_amazon_sku(m.amazon_sku))
    FROM matched m
    WHERE NOT EXISTS (SELECT 1 FROM amazon.asin_sku_map x
                      WHERE x.marketplace_id = m.marketplace_id AND x.asin = m.asin)
    ORDER BY m.marketplace_id, m.asin, m.catalogue_sku;

    SELECT public.amazon_sku_map_coverage() INTO v_report;
    RETURN v_report;
END;
$$;
