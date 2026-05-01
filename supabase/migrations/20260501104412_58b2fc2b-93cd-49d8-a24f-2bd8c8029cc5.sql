-- Fix channel fee calculation: fixed_fee should be per-ORDER, not per-LINE.
-- Spread it across lines_in_order, same way courier_full_cost is allocated.
-- VAT-grossed percentage fee remains per-line (it's % of the line's price * qty).
CREATE OR REPLACE VIEW public.order_line_economics
WITH (security_invoker=on) AS
WITH lines_priced AS (
  SELECT
    ol.*,
    COALESCE(ol.unit_price, 0::numeric) AS price,
    pc.cost_price AS cost_each,
    count(*) OVER (PARTITION BY ol.mintsoft_order_id) AS lines_in_order
  FROM order_lines ol
  LEFT JOIN products_cache pc ON pc.sku = ol.sku
  WHERE ol.order_date >= '2026-01-01'::timestamptz
),
courier_resolved AS (
  SELECT
    lp.*,
    COALESCE(cr.cost, 0::numeric) AS courier_full_cost,
    cr.courier
  FROM lines_priced lp
  LEFT JOIN courier_rates cr ON cr.service = lp.courier_service
),
fee_resolved AS (
  SELECT
    cr2.*,
    (
      SELECT row_to_json(r.*)
      FROM (
        SELECT vat_rate, fee_pct, fixed_fee, name
        FROM channel_fee_rules
        WHERE active = true
          AND COALESCE(cr2.channel, '') ILIKE channel_pattern
        ORDER BY priority
        LIMIT 1
      ) r
    ) AS fee_rule_json
  FROM courier_resolved cr2
)
SELECT
  id,
  mintsoft_order_id,
  line_index,
  sku,
  product_name,
  brand_id,
  qty,
  price,
  cost_each,
  currency,
  order_date,
  channel,
  courier_service,
  courier,
  order_status,
  lines_in_order,
  round(courier_full_cost / GREATEST(lines_in_order, 1)::numeric, 4) AS courier_cost,
  round(
    -- fixed fee shared across lines + per-line percentage on price * qty (grossed for VAT)
    COALESCE((fee_rule_json->>'fixed_fee')::numeric, 0)
      / GREATEST(lines_in_order, 1)::numeric
    + price
      * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20))
      * COALESCE((fee_rule_json->>'fee_pct')::numeric, 0)
      * qty::numeric
  , 4) AS channel_fee,
  fee_rule_json->>'name' AS fee_rule_name,
  round(price * qty::numeric, 4) AS order_value,
  round(
    (price - COALESCE(cost_each, 0)) * qty::numeric
    - courier_full_cost / GREATEST(lines_in_order, 1)::numeric
    - (
        COALESCE((fee_rule_json->>'fixed_fee')::numeric, 0)
          / GREATEST(lines_in_order, 1)::numeric
        + price
          * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20))
          * COALESCE((fee_rule_json->>'fee_pct')::numeric, 0)
          * qty::numeric
      )
  , 4) AS profit,
  CASE
    WHEN price > 0 AND qty > 0 THEN round(
      (
        (price - COALESCE(cost_each, 0)) * qty::numeric
        - courier_full_cost / GREATEST(lines_in_order, 1)::numeric
        - (
            COALESCE((fee_rule_json->>'fixed_fee')::numeric, 0)
              / GREATEST(lines_in_order, 1)::numeric
            + price
              * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20))
              * COALESCE((fee_rule_json->>'fee_pct')::numeric, 0)
              * qty::numeric
          )
      ) / NULLIF(price * qty::numeric * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20)), 0)
    , 6)
    ELSE NULL
  END AS por_pct,
  CASE
    WHEN length(sku) >= 4 AND substring(sku, 4, 1) = ANY(ARRAY['-', '/']) THEN 'Good'
    ELSE 'Dirt'
  END AS good_dirt,
  cost_each IS NULL OR cost_each = 0 AS missing_cost,
  EXTRACT(isoyear FROM order_date)::integer AS iso_year,
  EXTRACT(week FROM order_date)::integer AS iso_week,
  date_trunc('week', order_date)::date AS week_start
FROM fee_resolved;