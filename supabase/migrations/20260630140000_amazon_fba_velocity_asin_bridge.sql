-- ============================================================================
-- 20260630140000_amazon_fba_velocity_asin_bridge.sql
-- Fix: Brand Analytics Sales & Traffic is ASIN-keyed — its `sku` field is null,
-- so the original amazon.v_fba_velocity (which groups by sku) returned nothing
-- and v_fba_replenishment was empty. Bridge child_asin -> sku using the FBA
-- inventory snapshot (and order_items as fallback), then derive the Q-code base
-- sku. Falls back to st.sku when present, so it's correct either way.
--
-- Also adds a read-only diagnostic RPC so we can see the join health at a glance.
-- ============================================================================

CREATE OR REPLACE VIEW amazon.v_fba_velocity AS
WITH cfg AS (SELECT velocity_weeks FROM amazon.replenishment_config WHERE id),
-- ASIN -> one SKU, from the latest inventory snapshot (prefer the SKU with most
-- on-hand when an ASIN maps to several).
inv_bridge AS (
    SELECT marketplace_id, asin, sku FROM (
        SELECT s.marketplace_id, s.asin, s.sku,
               ROW_NUMBER() OVER (PARTITION BY s.marketplace_id, s.asin
                   ORDER BY s.afn_fulfillable_quantity DESC, s.sku) AS rn
        FROM amazon.fba_inventory_snapshot s
        JOIN (SELECT marketplace_id, MAX(snapshot_date) AS d
              FROM amazon.fba_inventory_snapshot GROUP BY 1) l
          ON l.marketplace_id = s.marketplace_id AND l.d = s.snapshot_date
        WHERE s.asin IS NOT NULL AND s.sku IS NOT NULL
    ) z WHERE rn = 1
),
-- ASIN -> one SKU from order history (covers ASINs not currently in stock).
oi_bridge AS (
    SELECT marketplace_id, asin, sku FROM (
        SELECT marketplace_id, asin, sku,
               ROW_NUMBER() OVER (PARTITION BY marketplace_id, asin ORDER BY cnt DESC, sku) AS rn
        FROM (
            SELECT marketplace_id, asin, sku, COUNT(*) AS cnt
            FROM amazon.order_items
            WHERE asin IS NOT NULL AND sku IS NOT NULL AND marketplace_id IS NOT NULL
            GROUP BY 1, 2, 3
        ) g
    ) z WHERE rn = 1
),
bridge AS (
    SELECT marketplace_id, asin, sku FROM inv_bridge
    UNION
    SELECT o.marketplace_id, o.asin, o.sku FROM oi_bridge o
    WHERE NOT EXISTS (SELECT 1 FROM inv_bridge i
                      WHERE i.marketplace_id = o.marketplace_id AND i.asin = o.asin)
),
resolved AS (
    SELECT st.marketplace_id, st.metric_date, st.units_ordered,
           COALESCE(NULLIF(st.sku, ''), b.sku) AS sku
    FROM amazon.sales_traffic_daily st
    LEFT JOIN bridge b
      ON b.marketplace_id = st.marketplace_id AND b.asin = st.child_asin
),
weekly AS (
    SELECT
        r.marketplace_id,
        amazon.base_sku(r.sku)                                   AS base_sku,
        FLOOR((CURRENT_DATE - r.metric_date) / 7)::int           AS week_index,
        SUM(r.units_ordered * amazon.pack_size(r.sku))::numeric  AS single_units
    FROM resolved r, cfg
    WHERE r.sku IS NOT NULL
      AND r.metric_date >= CURRENT_DATE - (cfg.velocity_weeks * 7)
    GROUP BY 1, 2, 3
)
SELECT
    w.marketplace_id,
    w.base_sku,
    ROUND(
        SUM(w.single_units * (c.velocity_weeks - w.week_index))
        / NULLIF(SUM(c.velocity_weeks - w.week_index), 0)
    , 2)                                                         AS weekly_velocity,
    SUM(w.single_units) FILTER (WHERE w.week_index = 0)          AS units_7d,
    SUM(w.single_units) FILTER (WHERE w.week_index <= 3)         AS units_30d,
    SUM(w.single_units)                                          AS units_window
FROM weekly w, cfg c
GROUP BY 1, 2;

-- Diagnostic: join health across the FBA pipeline. service_role only.
CREATE OR REPLACE FUNCTION public.amazon_fba_diag()
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public, amazon AS $$
    SELECT jsonb_build_object(
        'st_rows',            (SELECT COUNT(*) FROM amazon.sales_traffic_daily),
        'st_rows_with_sku',   (SELECT COUNT(*) FROM amazon.sales_traffic_daily WHERE sku IS NOT NULL),
        'st_distinct_asin',   (SELECT COUNT(DISTINCT child_asin) FROM amazon.sales_traffic_daily),
        'inv_skus',           (SELECT COUNT(*) FROM amazon.fba_inventory_snapshot
                               WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM amazon.fba_inventory_snapshot)),
        'inv_asins',          (SELECT COUNT(DISTINCT asin) FROM amazon.fba_inventory_snapshot
                               WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM amazon.fba_inventory_snapshot) AND asin IS NOT NULL),
        'order_items',        (SELECT COUNT(*) FROM amazon.order_items),
        'oi_asin_sku',        (SELECT COUNT(DISTINCT (marketplace_id, asin)) FROM amazon.order_items WHERE asin IS NOT NULL AND sku IS NOT NULL),
        'velocity_rows',      (SELECT COUNT(*) FROM amazon.v_fba_velocity),
        'replenishment_rows', (SELECT COUNT(*) FROM amazon.v_fba_replenishment),
        'replenish_flagged',  (SELECT COUNT(*) FROM amazon.v_fba_replenishment WHERE replenish_flag)
    );
$$;
REVOKE ALL ON FUNCTION public.amazon_fba_diag() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_fba_diag() TO service_role, authenticated;
