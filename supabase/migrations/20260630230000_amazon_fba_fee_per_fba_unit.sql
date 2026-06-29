-- ============================================================================
-- 20260630230000_amazon_fba_fee_per_fba_unit.sql
-- Refine the FBA fulfilment fee: it only applies to units Amazon shipped, so
-- divide FBA fees by FBA UNITS (AFN orders), not all-channel S&T units. Fixes
-- the FBM-heavy dilution (e.g. NGK reading £0.01/unit). Referral % stays blended
-- (Amazon charges it on FBA + FBM alike). Full DROP/CREATE (matview + views).
-- ============================================================================

DROP VIEW IF EXISTS public.v_fba_replenishment;
DROP VIEW IF EXISTS amazon.v_fba_replenishment;
DROP MATERIALIZED VIEW IF EXISTS amazon.mv_sku_economics CASCADE;

CREATE MATERIALIZED VIEW amazon.mv_sku_economics AS
WITH win AS (SELECT velocity_weeks FROM amazon.replenishment_config WHERE id),
sku_cat AS (
    SELECT DISTINCT ON (oi.marketplace_id, oi.sku)
           oi.marketplace_id, oi.sku AS seller_sku, m.catalogue_sku
    FROM amazon.order_items oi
    JOIN amazon.asin_sku_map m ON m.marketplace_id = oi.marketplace_id AND m.asin = oi.asin
    WHERE oi.sku IS NOT NULL AND m.catalogue_sku IS NOT NULL
    ORDER BY oi.marketplace_id, oi.sku, m.catalogue_sku
),
sell AS (
    SELECT x.marketplace_id, amazon.base_sku(x.resolved_sku) AS base_sku,
           SUM(st.ordered_product_sales)                            AS revenue,
           SUM(st.units_ordered * amazon.pack_size(x.resolved_sku)) AS units
    FROM amazon.sales_traffic_daily st
    JOIN amazon.v_asin_sku x ON x.marketplace_id = st.marketplace_id AND x.asin = st.child_asin
    WHERE x.resolved_sku IS NOT NULL
      AND st.metric_date >= CURRENT_DATE - (SELECT velocity_weeks FROM win) * 7
    GROUP BY 1, 2
),
-- FBA units actually shipped by Amazon (AFN) — the correct FBA-fee denominator.
fba_units AS (
    SELECT oi.marketplace_id, amazon.base_sku(x.resolved_sku) AS base_sku,
           SUM(oi.quantity * amazon.pack_size(x.resolved_sku)) AS units
    FROM amazon.order_items oi
    JOIN amazon.orders o
      ON o.marketplace_id = oi.marketplace_id AND o.amazon_order_id = oi.amazon_order_id
    JOIN amazon.v_asin_sku x ON x.marketplace_id = oi.marketplace_id AND x.asin = oi.asin
    WHERE upper(COALESCE(o.fulfillment_channel, '')) IN ('AMAZON', 'AFN')
      AND o.purchase_date >= CURRENT_DATE - (SELECT velocity_weeks FROM win) * 7
    GROUP BY 1, 2
),
fee AS (
    SELECT fe.marketplace_id, amazon.base_sku(sc.catalogue_sku) AS base_sku,
           SUM(fe.amount) FILTER (WHERE fe.event_subtype = 'Principal' AND fe.direction = 'credit')  AS principal_rev,
           SUM(fe.amount) FILTER (WHERE fe.event_subtype = 'Commission')                             AS referral_fees,
           SUM(fe.amount) FILTER (WHERE fe.event_subtype = 'FBAPerUnitFulfillmentFee')               AS fba_fees
    FROM amazon.financial_events fe
    JOIN sku_cat sc ON sc.marketplace_id = fe.marketplace_id AND sc.seller_sku = fe.sku
    WHERE fe.event_type = 'Shipment'
      AND fe.posted_date >= CURRENT_DATE - (SELECT velocity_weeks FROM win) * 7
    GROUP BY 1, 2
)
SELECT
    s.marketplace_id,
    s.base_sku,
    ROUND(s.revenue / NULLIF(s.units, 0), 2)                                 AS avg_sell_price,
    s.units                                                                  AS units_sold,
    fu.units                                                                 AS fba_units,
    CASE WHEN f.principal_rev > 0 THEN f.referral_fees / f.principal_rev END AS referral_pct,
    CASE WHEN fu.units > 0 THEN ROUND(f.fba_fees / fu.units, 2) END          AS fba_fee_per_unit,
    f.principal_rev, f.referral_fees, f.fba_fees
FROM sell s
LEFT JOIN fee f       ON f.marketplace_id = s.marketplace_id AND f.base_sku = s.base_sku
LEFT JOIN fba_units fu ON fu.marketplace_id = s.marketplace_id AND fu.base_sku = s.base_sku;

CREATE UNIQUE INDEX mv_sku_economics_pk ON amazon.mv_sku_economics (marketplace_id, base_sku);

CREATE OR REPLACE FUNCTION public.amazon_refresh_economics()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, amazon AS $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY amazon.mv_sku_economics;
$$;
REVOKE ALL ON FUNCTION public.amazon_refresh_economics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_refresh_economics() TO service_role;

CREATE VIEW amazon.v_fba_replenishment AS
WITH cfg AS (SELECT target_weeks_cover, default_moq FROM amazon.replenishment_config WHERE id),
inv AS (
    SELECT x.marketplace_id, amazon.base_sku(x.resolved_sku) AS base_sku,
           SUM(s.afn_fulfillable_quantity * amazon.pack_size(x.resolved_sku)) AS on_hand_units,
           SUM((s.afn_inbound_working_quantity + s.afn_inbound_shipped_quantity
                + s.afn_inbound_receiving_quantity) * amazon.pack_size(x.resolved_sku)) AS in_transit_units
    FROM amazon.fba_inventory_snapshot s
    JOIN (SELECT marketplace_id, MAX(snapshot_date) AS d FROM amazon.fba_inventory_snapshot GROUP BY 1) latest
      ON latest.marketplace_id = s.marketplace_id AND latest.d = s.snapshot_date
    JOIN amazon.v_asin_sku x ON x.marketplace_id = s.marketplace_id AND x.asin = s.asin
    WHERE x.resolved_sku IS NOT NULL
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
    pc.cost_price                                       AS unit_cost,
    ROUND(b.units_to_order * pc.cost_price, 2)          AS reorder_cost,
    e.avg_sell_price,
    ROUND(e.avg_sell_price * COALESCE(e.referral_pct, 0), 2)   AS referral_fee_per_unit,
    e.fba_fee_per_unit,
    CASE WHEN pc.cost_price IS NOT NULL AND e.avg_sell_price > 0
         THEN ROUND(100 * (e.avg_sell_price - pc.cost_price) / e.avg_sell_price, 1) END AS gross_margin_pct,
    ROUND(e.avg_sell_price
          - e.avg_sell_price * COALESCE(e.referral_pct, 0)
          - COALESCE(e.fba_fee_per_unit, 0)
          - pc.cost_price, 2)                            AS net_per_unit,
    CASE WHEN pc.cost_price IS NOT NULL AND e.avg_sell_price > 0
         THEN ROUND(100 * (e.avg_sell_price
                  - e.avg_sell_price * COALESCE(e.referral_pct, 0)
                  - COALESCE(e.fba_fee_per_unit, 0)
                  - pc.cost_price) / e.avg_sell_price, 1) END AS net_margin_pct
FROM base b
LEFT JOIN public.products_cache pc ON pc.sku = b.base_sku
LEFT JOIN amazon.mv_sku_economics e ON e.marketplace_id = b.marketplace_id AND e.base_sku = b.base_sku;

CREATE VIEW public.v_fba_replenishment AS SELECT * FROM amazon.v_fba_replenishment;
REVOKE ALL ON public.v_fba_replenishment FROM anon;
GRANT SELECT ON public.v_fba_replenishment TO authenticated;
