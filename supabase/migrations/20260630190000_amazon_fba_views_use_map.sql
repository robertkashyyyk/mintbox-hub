-- ============================================================================
-- 20260630190000_amazon_fba_views_use_map.sql
-- Wire amazon.asin_sku_map into the FBA velocity + replenishment views so they
-- run on PROPER catalogue SKUs. Both the demand side (S&T) and the stock side
-- (inventory) resolve the same way (ASIN -> catalogue SKU via the map, falling
-- back to the Amazon seller-SKU when unmapped) so they still join on base_sku.
-- Output columns are unchanged, so the public wrapper + the page are unaffected.
-- ============================================================================

-- Canonical ASIN -> resolved SKU. catalogue_sku when mapped; else a representative
-- Amazon seller-SKU (inventory preferred, then orders) so unmapped demand/stock
-- isn't lost — it just shows under its Amazon SKU until mapped.
CREATE OR REPLACE VIEW amazon.v_asin_sku AS
WITH seller AS (
    SELECT DISTINCT ON (marketplace_id, asin) marketplace_id, asin, amazon_sku
    FROM (
        SELECT s.marketplace_id, s.asin, s.sku AS amazon_sku, 1 AS pri
        FROM amazon.fba_inventory_snapshot s
        JOIN (SELECT marketplace_id, MAX(snapshot_date) d FROM amazon.fba_inventory_snapshot GROUP BY 1) l
          ON l.marketplace_id = s.marketplace_id AND l.d = s.snapshot_date
        WHERE s.asin IS NOT NULL AND s.sku IS NOT NULL
        UNION ALL
        SELECT oi.marketplace_id, oi.asin, oi.sku, 2
        FROM amazon.order_items oi WHERE oi.asin IS NOT NULL AND oi.sku IS NOT NULL
    ) z
    ORDER BY marketplace_id, asin, pri
)
SELECT
    COALESCE(sl.marketplace_id, m.marketplace_id) AS marketplace_id,
    COALESCE(sl.asin, m.asin)                     AS asin,
    COALESCE(m.catalogue_sku, sl.amazon_sku)      AS resolved_sku,
    (m.catalogue_sku IS NOT NULL)                 AS is_catalogue
FROM seller sl
FULL JOIN amazon.asin_sku_map m
       ON m.marketplace_id = sl.marketplace_id AND m.asin = sl.asin;

-- Velocity now resolves S&T child_asin -> catalogue SKU via the map.
CREATE OR REPLACE VIEW amazon.v_fba_velocity AS
WITH cfg AS (SELECT velocity_weeks FROM amazon.replenishment_config WHERE id),
resolved AS (
    SELECT st.marketplace_id, st.metric_date, st.units_ordered, x.resolved_sku AS sku
    FROM amazon.sales_traffic_daily st
    JOIN amazon.v_asin_sku x
      ON x.marketplace_id = st.marketplace_id AND x.asin = st.child_asin
    WHERE x.resolved_sku IS NOT NULL
),
weekly AS (
    SELECT
        r.marketplace_id,
        amazon.base_sku(r.sku)                                  AS base_sku,
        FLOOR((CURRENT_DATE - r.metric_date) / 7)::int          AS week_index,
        SUM(r.units_ordered * amazon.pack_size(r.sku))::numeric AS single_units
    FROM resolved r, cfg
    WHERE r.metric_date >= CURRENT_DATE - (cfg.velocity_weeks * 7)
    GROUP BY 1, 2, 3
)
SELECT
    w.marketplace_id,
    w.base_sku,
    ROUND(SUM(w.single_units * (c.velocity_weeks - w.week_index))
          / NULLIF(SUM(c.velocity_weeks - w.week_index), 0), 2)  AS weekly_velocity,
    SUM(w.single_units) FILTER (WHERE w.week_index = 0)          AS units_7d,
    SUM(w.single_units) FILTER (WHERE w.week_index <= 3)         AS units_30d,
    SUM(w.single_units)                                          AS units_window
FROM weekly w, cfg c
GROUP BY 1, 2;

-- Replenishment: inventory side resolves through the SAME map so on-hand keys
-- match velocity's catalogue base_sku.
CREATE OR REPLACE VIEW amazon.v_fba_replenishment AS
WITH cfg AS (SELECT target_weeks_cover, default_moq FROM amazon.replenishment_config WHERE id),
inv AS (
    SELECT x.marketplace_id, amazon.base_sku(x.resolved_sku) AS base_sku,
           SUM(s.afn_fulfillable_quantity * amazon.pack_size(x.resolved_sku)) AS on_hand_units,
           SUM((s.afn_inbound_working_quantity + s.afn_inbound_shipped_quantity
                + s.afn_inbound_receiving_quantity) * amazon.pack_size(x.resolved_sku)) AS in_transit_units
    FROM amazon.fba_inventory_snapshot s
    JOIN (SELECT marketplace_id, MAX(snapshot_date) AS d
          FROM amazon.fba_inventory_snapshot GROUP BY 1) latest
      ON latest.marketplace_id = s.marketplace_id AND latest.d = s.snapshot_date
    JOIN amazon.v_asin_sku x
      ON x.marketplace_id = s.marketplace_id AND x.asin = s.asin
    WHERE x.resolved_sku IS NOT NULL
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
