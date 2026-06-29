-- ============================================================================
-- 20260630200000_amazon_fba_replenishment_cost.sql
-- Close the loop: add cost economics to v_fba_replenishment now that it runs on
-- catalogue SKUs. Joins products_cache.cost_price + the S&T average sell price:
--   unit_cost, reorder_cost (= units_to_order x cost), avg_sell_price,
--   gross_margin_pct (pre Amazon fees).
-- Existing columns are preserved (the wrapper SELECT * + page pick up the new
-- ones); net-of-Amazon-fees per SKU is the follow-on (Finances join).
-- ============================================================================

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
    JOIN amazon.v_asin_sku x ON x.marketplace_id = s.marketplace_id AND x.asin = s.asin
    WHERE x.resolved_sku IS NOT NULL
    GROUP BY 1, 2
),
sell AS (   -- average single-unit sell price over the velocity window, per base_sku
    SELECT x.marketplace_id, amazon.base_sku(x.resolved_sku) AS base_sku,
           SUM(st.ordered_product_sales)                              AS revenue,
           SUM(st.units_ordered * amazon.pack_size(x.resolved_sku))   AS single_units
    FROM amazon.sales_traffic_daily st
    JOIN amazon.v_asin_sku x ON x.marketplace_id = st.marketplace_id AND x.asin = st.child_asin
    WHERE x.resolved_sku IS NOT NULL
      AND st.metric_date >= CURRENT_DATE - (SELECT velocity_weeks FROM amazon.replenishment_config WHERE id) * 7
    GROUP BY 1, 2
),
base AS (
    SELECT
        v.marketplace_id, m.country_code, v.base_sku, v.weekly_velocity, v.units_7d, v.units_30d,
        COALESCE(inv.on_hand_units, 0)    AS fba_on_hand,
        COALESCE(inv.in_transit_units, 0) AS fba_in_transit,
        ROUND(cfg.target_weeks_cover * v.weekly_velocity, 1) AS target_units,
        CASE WHEN v.weekly_velocity > 0
             THEN ROUND((COALESCE(inv.on_hand_units,0) + COALESCE(inv.in_transit_units,0)) / v.weekly_velocity, 1)
             ELSE NULL END AS days_of_cover_weeks,
        GREATEST(0, CEIL(cfg.target_weeks_cover * v.weekly_velocity
                         - COALESCE(inv.on_hand_units,0) - COALESCE(inv.in_transit_units,0)))::int AS raw_units_to_order,
        CEIL(GREATEST(0, CEIL(cfg.target_weeks_cover * v.weekly_velocity
                         - COALESCE(inv.on_hand_units,0) - COALESCE(inv.in_transit_units,0)))::numeric
             / cfg.default_moq)::int * cfg.default_moq AS units_to_order,
        (cfg.target_weeks_cover * v.weekly_velocity
            - COALESCE(inv.on_hand_units,0) - COALESCE(inv.in_transit_units,0)) > 0 AS replenish_flag
    FROM amazon.v_fba_velocity v
    JOIN amazon.marketplace m ON m.marketplace_id = v.marketplace_id
    CROSS JOIN cfg
    LEFT JOIN inv ON inv.marketplace_id = v.marketplace_id AND inv.base_sku = v.base_sku
    WHERE v.weekly_velocity > 0
)
SELECT
    b.*,
    pc.cost_price                                            AS unit_cost,
    ROUND(b.units_to_order * pc.cost_price, 2)               AS reorder_cost,
    ROUND(s.revenue / NULLIF(s.single_units, 0), 2)          AS avg_sell_price,
    CASE WHEN pc.cost_price IS NOT NULL AND s.revenue / NULLIF(s.single_units, 0) > 0
         THEN ROUND(100 * (s.revenue / NULLIF(s.single_units,0) - pc.cost_price)
                    / (s.revenue / NULLIF(s.single_units,0)), 1)
         END                                                 AS gross_margin_pct
FROM base b
LEFT JOIN public.products_cache pc ON pc.sku = b.base_sku
LEFT JOIN sell s ON s.marketplace_id = b.marketplace_id AND s.base_sku = b.base_sku;
