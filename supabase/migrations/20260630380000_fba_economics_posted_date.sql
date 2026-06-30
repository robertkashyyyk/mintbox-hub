-- ============================================================================
-- 20260630380000_fba_economics_posted_date.sql
-- Fix the FBA settlement lag: attribute FBA economics to the SETTLEMENT week
-- (financial_events.posted_date) instead of the order/purchase week. FBA fees
-- post a few days after the sale, and we only count settled lines — so on a
-- purchase-date basis the latest weeks looked near-empty (e.g. W26 = £73). On a
-- posted-date basis a completed week is whole (matches Amazon's own statements);
-- only the live current week is naturally partial, which is correct.
--
-- Column shape unchanged, so order_economics_all + the profit RPCs are unaffected;
-- only FBA rows' week attribution shifts to when they settled.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_fba_order_economics AS
WITH fe AS (   -- settled revenue + real fees per (order, seller-sku), with posted date
    SELECT marketplace_id, amazon_order_id, sku AS seller_sku,
           SUM(amount) FILTER (WHERE event_subtype = 'Principal' AND direction = 'credit') AS revenue,
           SUM(amount) FILTER (WHERE event_subtype = 'Commission')                         AS referral_fee,
           SUM(amount) FILTER (WHERE event_subtype = 'FBAPerUnitFulfillmentFee')           AS fba_fee,
           MIN(posted_date)                                                                AS posted_date
    FROM amazon.financial_events
    WHERE event_type = 'Shipment' AND sku IS NOT NULL
    GROUP BY 1, 2, 3
    HAVING SUM(amount) FILTER (WHERE event_subtype = 'Principal' AND direction = 'credit') > 0
),
oi AS (        -- FBA (AFN) order lines — for qty / asin / name
    SELECT o.marketplace_id, o.amazon_order_id, oi.sku AS seller_sku,
           MIN(oi.asin) AS asin, SUM(oi.quantity) AS qty,
           MIN(oi.product_name) AS product_name, MIN(o.order_status) AS order_status
    FROM amazon.order_items oi
    JOIN amazon.orders o ON o.marketplace_id = oi.marketplace_id AND o.amazon_order_id = oi.amazon_order_id
    WHERE upper(COALESCE(o.fulfillment_channel, '')) IN ('AMAZON', 'AFN')
    GROUP BY 1, 2, 3
),
joined AS (
    SELECT fe.marketplace_id, fe.amazon_order_id, fe.seller_sku, fe.revenue, fe.referral_fee, fe.fba_fee,
           fe.posted_date, oi.qty, oi.asin, oi.product_name, oi.order_status, map.catalogue_sku
    FROM fe
    JOIN oi ON oi.marketplace_id = fe.marketplace_id AND oi.amazon_order_id = fe.amazon_order_id AND oi.seller_sku = fe.seller_sku
    LEFT JOIN amazon.asin_sku_map map ON map.marketplace_id = fe.marketplace_id AND map.asin = oi.asin
    WHERE fe.posted_date >= '2026-03-16'::timestamptz   -- W12 floor, on settlement basis
),
enriched AS (
    SELECT j.*,
           COALESCE(j.catalogue_sku, j.seller_sku) AS final_sku,
           pc.cost_price, pc.brand_id, COALESCE(pc.name, j.product_name) AS pname,
           COUNT(*)     OVER (PARTITION BY j.amazon_order_id) AS lines_in_order,
           ROW_NUMBER() OVER (PARTITION BY j.amazon_order_id ORDER BY j.seller_sku) AS line_index
    FROM joined j
    LEFT JOIN public.products_cache pc ON pc.sku = COALESCE(j.catalogue_sku, j.seller_sku)
)
SELECT
    ('fba:' || amazon_order_id || ':' || seller_sku)            AS id,
    hashtextextended(amazon_order_id, 0)                        AS mintsoft_order_id,
    line_index::integer                                        AS line_index,
    final_sku                                                  AS sku,
    pname                                                      AS product_name,
    brand_id,
    qty::integer                                              AS qty,
    ROUND(revenue / NULLIF(qty, 0), 6)                        AS price,
    cost_price                                                AS cost_each,
    'GBP'::text                                               AS currency,
    posted_date                                               AS order_date,   -- settlement basis
    'Amazon FBA'::text                                        AS channel,
    'FBA'::text                                               AS courier_service,
    'Amazon FBA'::text                                        AS courier,
    order_status,
    lines_in_order::bigint                                    AS lines_in_order,
    ROUND(COALESCE(fba_fee, 0), 4)                           AS courier_cost,
    ROUND(COALESCE(referral_fee, 0), 4)                      AS channel_fee,
    'Amazon FBA (actual fees)'::text                         AS fee_rule_name,
    ROUND(revenue, 4)                                        AS order_value,
    ROUND(revenue - COALESCE(cost_price,0) * qty - COALESCE(fba_fee,0) - COALESCE(referral_fee,0), 4) AS profit,
    CASE WHEN revenue > 0 AND qty > 0
         THEN ROUND((revenue - COALESCE(cost_price,0)*qty - COALESCE(fba_fee,0) - COALESCE(referral_fee,0))
                    / NULLIF(revenue * 1.2, 0), 6)
         END                                                 AS por_pct,
    CASE WHEN length(final_sku) >= 4 AND substring(final_sku, 4, 1) = ANY(ARRAY['-','/']) THEN 'Good' ELSE 'Dirt' END AS good_dirt,
    cost_price IS NULL OR cost_price = 0                      AS missing_cost,
    EXTRACT(isoyear FROM posted_date)::integer               AS iso_year,
    EXTRACT(week FROM posted_date)::integer                  AS iso_week,
    date_trunc('week', posted_date)::date                    AS week_start
FROM enriched;
