-- FBA Q-code packs were not decomposed to singles: v_fba_order_economics used raw order
-- quantity and resolved cost against the -Q0N catalogue SKU (which has no cost), inflating
-- profit and undercounting units. Fix: mirror Mintsoft atomisation — derive the atom via
-- amazon.base_sku(catalogue_sku), the multiplier via amazon.pack_size(catalogue_sku),
-- count singles = qty * pack, and resolve cost on the ATOM.
-- (Applied to prod 2026-07-08 via MCP apply_migration; file added for repo parity.)
CREATE OR REPLACE VIEW public.v_fba_order_economics AS
WITH fe AS (
  SELECT financial_events.marketplace_id,
    financial_events.amazon_order_id,
    financial_events.sku AS seller_sku,
    sum(financial_events.amount) FILTER (WHERE financial_events.event_subtype = 'Principal'::text AND financial_events.direction = 'credit'::text) AS revenue,
    sum(financial_events.amount) FILTER (WHERE financial_events.event_subtype = 'Commission'::text) AS referral_fee,
    sum(financial_events.amount) FILTER (WHERE financial_events.event_subtype = 'FBAPerUnitFulfillmentFee'::text) AS fba_fee,
    min(financial_events.posted_date) AS posted_date
  FROM amazon.financial_events
  WHERE financial_events.event_type = 'Shipment'::text AND financial_events.sku IS NOT NULL
  GROUP BY financial_events.marketplace_id, financial_events.amazon_order_id, financial_events.sku
  HAVING sum(financial_events.amount) FILTER (WHERE financial_events.event_subtype = 'Principal'::text AND financial_events.direction = 'credit'::text) > 0::numeric
),
oi AS (
  SELECT o.marketplace_id, o.amazon_order_id, oi.sku AS seller_sku,
    min(oi.asin) AS asin, sum(oi.quantity) AS qty,
    min(oi.product_name) AS product_name, min(o.order_status) AS order_status
  FROM amazon.order_items oi
    JOIN amazon.orders o ON o.marketplace_id = oi.marketplace_id AND o.amazon_order_id = oi.amazon_order_id
  WHERE upper(COALESCE(o.fulfillment_channel, ''::text)) = ANY (ARRAY['AMAZON'::text, 'AFN'::text])
  GROUP BY o.marketplace_id, o.amazon_order_id, oi.sku
),
joined AS (
  SELECT fe.marketplace_id, fe.amazon_order_id, fe.seller_sku, fe.revenue, fe.referral_fee, fe.fba_fee, fe.posted_date,
    oi.qty, oi.asin, oi.product_name, oi.order_status,
    map.catalogue_sku,
    COALESCE(NULLIF(amazon.base_sku(map.catalogue_sku), ''::text), fe.seller_sku) AS atom_sku,
    amazon.pack_size(map.catalogue_sku) AS pack_size
  FROM fe
    JOIN oi ON oi.marketplace_id = fe.marketplace_id AND oi.amazon_order_id = fe.amazon_order_id AND oi.seller_sku = fe.seller_sku
    LEFT JOIN amazon.asin_sku_map map ON map.marketplace_id = fe.marketplace_id AND map.asin = oi.asin
  WHERE fe.posted_date >= '2026-03-16 00:00:00+00'::timestamp with time zone
),
enriched AS (
  SELECT j.marketplace_id, j.amazon_order_id, j.seller_sku, j.revenue, j.referral_fee, j.fba_fee, j.posted_date,
    j.qty, j.asin, j.product_name, j.order_status, j.catalogue_sku, j.atom_sku, j.pack_size,
    (j.qty * j.pack_size) AS single_qty,
    pc.cost_price, pc.brand_id,
    COALESCE(pc.name, j.product_name) AS pname,
    count(*) OVER (PARTITION BY j.amazon_order_id) AS lines_in_order,
    row_number() OVER (PARTITION BY j.amazon_order_id ORDER BY j.seller_sku) AS line_index
  FROM joined j
    LEFT JOIN products_cache pc ON pc.sku = j.atom_sku
)
SELECT (('fba:'::text || amazon_order_id) || ':'::text) || seller_sku AS id,
  hashtextextended(amazon_order_id, 0::bigint) AS mintsoft_order_id,
  line_index::integer AS line_index,
  atom_sku AS sku,
  pname AS product_name,
  brand_id,
  single_qty::integer AS qty,
  round(revenue / NULLIF(single_qty, 0)::numeric, 6) AS price,
  cost_price AS cost_each,
  'GBP'::text AS currency,
  posted_date AS order_date,
  'Amazon FBA'::text AS channel,
  'FBA'::text AS courier_service,
  'Amazon FBA'::text AS courier,
  order_status,
  lines_in_order,
  round(COALESCE(fba_fee, 0::numeric), 4) AS courier_cost,
  round(COALESCE(referral_fee, 0::numeric), 4) AS channel_fee,
  'Amazon FBA (actual fees)'::text AS fee_rule_name,
  round(revenue, 4) AS order_value,
  round(revenue - COALESCE(cost_price, 0::numeric) * single_qty::numeric - COALESCE(fba_fee, 0::numeric) - COALESCE(referral_fee, 0::numeric), 4) AS profit,
  CASE
    WHEN revenue > 0::numeric AND single_qty > 0 THEN round((revenue - COALESCE(cost_price, 0::numeric) * single_qty::numeric - COALESCE(fba_fee, 0::numeric) - COALESCE(referral_fee, 0::numeric)) / NULLIF(revenue * 1.2, 0::numeric), 6)
    ELSE NULL::numeric
  END AS por_pct,
  CASE
    WHEN length(atom_sku) >= 4 AND (substring(atom_sku, 4, 1) = ANY (ARRAY['-'::text, '/'::text])) THEN 'Good'::text
    ELSE 'Dirt'::text
  END AS good_dirt,
  cost_price IS NULL OR cost_price = 0::numeric AS missing_cost,
  EXTRACT(isoyear FROM posted_date)::integer AS iso_year,
  EXTRACT(week FROM posted_date)::integer AS iso_week,
  date_trunc('week'::text, posted_date)::date AS week_start
FROM enriched;
