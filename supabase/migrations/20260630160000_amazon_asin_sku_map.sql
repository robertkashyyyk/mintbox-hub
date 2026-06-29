-- ============================================================================
-- 20260630160000_amazon_asin_sku_map.sql
-- Map Amazon ASIN -> proper Hub catalogue SKU, so FBA velocity/replenishment and
-- the cost-price join run on real catalogue keys (not messy Amazon seller-SKUs).
--
-- Waterfall (take first hit, pin per ASIN):
--   1. order_join     — amazon.order_items.amazon_order_id = order_lines.order_number
--                       (channel Amazon), single-line both sides => ASIN <-> catalogue
--                       SKU from real fulfilled orders. GROUND TRUTH. Zero API.
--   2. sku_normalized — strip Amazon suffixes (_FBA/_SnL/-LN) + Q-codes off the
--                       seller-SKU, match to products_cache.sku. Own-brand/ASC. Zero API.
--   3. (barcode/manual added later if the residue warrants it.)
--
-- Manual rows (is_manual) are never clobbered by a rebuild.
-- ============================================================================

CREATE TABLE IF NOT EXISTS amazon.asin_sku_map (
    marketplace_id TEXT NOT NULL,
    asin           TEXT NOT NULL,
    catalogue_sku  TEXT,                       -- resolved Hub products_cache.sku
    amazon_sku     TEXT,                       -- representative Amazon seller-SKU
    match_method   TEXT NOT NULL,              -- order_join | sku_normalized | barcode | manual
    confidence     NUMERIC,                    -- order_join: # matched orders
    evidence       JSONB,
    is_manual      BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (marketplace_id, asin)
);

-- Normalise an Amazon seller-SKU toward a catalogue SKU: drop trailing channel
-- suffixes and the Q-code pack tag, upper-case for case-insensitive match.
CREATE OR REPLACE FUNCTION amazon.normalize_amazon_sku(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT upper(
        regexp_replace(
            regexp_replace(COALESCE(p, ''), '(?i)(_FBA|_FBM|_SNL|_LN|-LN|_NEW|_OLD)+$', '', 'g'),
            '(?i)-Q[0-9]+$', ''
        )
    )
$$;

-- Rebuild the non-manual rows, then return a coverage report.
CREATE OR REPLACE FUNCTION public.amazon_rebuild_sku_map()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, amazon
AS $$
DECLARE v_report JSONB;
BEGIN
    DELETE FROM amazon.asin_sku_map WHERE NOT is_manual;

    -- 1. ORDER-JOIN (single distinct ASIN on Amazon side, single distinct SKU on
    --    Mintsoft side, joined by Amazon order id). Modal catalogue SKU per ASIN.
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

    -- 2. SKU-NORMALISE for ASINs still unresolved. Representative seller-SKU per
    --    ASIN (inventory first, then orders) -> normalise -> products_cache.sku.
    WITH asin_seller AS (
        SELECT marketplace_id, asin, amazon_sku FROM (
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
        SELECT marketplace_id, asin, amazon_sku FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY marketplace_id, asin ORDER BY pri) AS r2
            FROM (SELECT marketplace_id, asin, amazon_sku,
                         MIN(CASE WHEN amazon_sku IS NOT NULL THEN 1 END) OVER (PARTITION BY marketplace_id, asin) AS pri
                  FROM asin_seller) q
        ) w WHERE r2 = 1
    ),
    matched AS (
        SELECT b.marketplace_id, b.asin, b.amazon_sku, pc.sku AS catalogue_sku
        FROM best_seller b
        JOIN public.products_cache pc
          ON upper(pc.sku) = amazon.normalize_amazon_sku(b.amazon_sku)
         AND COALESCE(pc.discontinued, false) = false
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

-- Velocity-weighted coverage of the demand ASIN universe (last 8 weeks).
CREATE OR REPLACE FUNCTION public.amazon_sku_map_coverage()
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public, amazon
AS $$
    WITH demand AS (
        SELECT st.marketplace_id, st.child_asin AS asin, SUM(st.units_ordered) AS units
        FROM amazon.sales_traffic_daily st
        WHERE st.metric_date >= CURRENT_DATE - 56 AND st.units_ordered > 0
        GROUP BY 1, 2
    ),
    j AS (
        SELECT d.asin, d.units, COALESCE(m.match_method, 'unmatched') AS method
        FROM demand d
        LEFT JOIN amazon.asin_sku_map m ON m.marketplace_id = d.marketplace_id AND m.asin = d.asin
    )
    SELECT jsonb_build_object(
        'demand_asins',       (SELECT COUNT(*) FROM demand),
        'demand_units',       (SELECT COALESCE(SUM(units),0) FROM demand),
        'by_method',          (SELECT jsonb_object_agg(method, cnt) FROM (SELECT method, COUNT(*) cnt FROM j GROUP BY 1) x),
        'units_by_method',    (SELECT jsonb_object_agg(method, u)   FROM (SELECT method, SUM(units) u FROM j GROUP BY 1) y),
        'asins_pct_mapped',   (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE method <> 'unmatched') / NULLIF(COUNT(*),0), 1) FROM j),
        'units_pct_mapped',   (SELECT ROUND(100.0 * SUM(units) FILTER (WHERE method <> 'unmatched') / NULLIF(SUM(units),0), 1) FROM j),
        'map_rows_total',     (SELECT COUNT(*) FROM amazon.asin_sku_map),
        'map_rows_manual',    (SELECT COUNT(*) FROM amazon.asin_sku_map WHERE is_manual)
    );
$$;

REVOKE ALL ON FUNCTION public.amazon_rebuild_sku_map() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_rebuild_sku_map() TO service_role;
REVOKE ALL ON FUNCTION public.amazon_sku_map_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_sku_map_coverage() TO service_role, authenticated;
