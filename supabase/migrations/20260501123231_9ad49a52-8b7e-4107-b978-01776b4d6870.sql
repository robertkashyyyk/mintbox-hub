-- Cost-weighted revenue reallocation across lines of the same order
-- Problem: Mintsoft sometimes posts the full order revenue onto a single line,
-- leaving sibling lines at £0. This skews per-line profit/POR badly.
-- Fix: compute the order's total observed revenue, then redistribute it across
-- all its lines weighted by (cost_each * qty). Fallback weight = qty when no
-- cost data is available. Single-line orders are unaffected.

CREATE OR REPLACE VIEW public.order_line_economics
WITH (security_invoker=on) AS
WITH lines_priced AS (
  SELECT
    ol.*,
    COALESCE(ol.unit_price, 0::numeric) AS raw_price,
    pc.cost_price AS cost_each,
    count(*) OVER (PARTITION BY ol.mintsoft_order_id) AS lines_in_order,
    -- Total observed revenue on the whole order (sum of unit_price * qty across its lines)
    SUM(COALESCE(ol.unit_price, 0::numeric) * ol.qty::numeric)
      OVER (PARTITION BY ol.mintsoft_order_id) AS order_revenue_total,
    -- Weight for this line: cost_each * qty (preferred), else qty as fallback
    COALESCE(pc.cost_price, 0::numeric) * ol.qty::numeric AS cost_weight,
    SUM(COALESCE(pc.cost_price, 0::numeric) * ol.qty::numeric)
      OVER (PARTITION BY ol.mintsoft_order_id) AS cost_weight_total,
    SUM(ol.qty::numeric) OVER (PARTITION BY ol.mintsoft_order_id) AS qty_total
  FROM order_lines ol
  LEFT JOIN products_cache pc ON pc.sku = ol.sku
  WHERE ol.order_date >= '2026-01-01'::timestamptz
),
lines_realloc AS (
  SELECT
    lp.*,
    -- Allocated line revenue (total revenue * weight share)
    CASE
      WHEN lines_in_order <= 1 THEN raw_price * qty::numeric
      WHEN cost_weight_total > 0 THEN
        order_revenue_total * (cost_weight / cost_weight_total)
      WHEN qty_total > 0 THEN
        order_revenue_total * (qty::numeric / qty_total)
      ELSE raw_price * qty::numeric
    END AS line_revenue
  FROM lines_priced lp
),
courier_resolved AS (
  SELECT
    lr.*,
    COALESCE(cr.cost, 0::numeric) AS courier_full_cost,
    cr.courier
  FROM lines_realloc lr
  LEFT JOIN courier_rates cr ON cr.service = lr.courier_service
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
  -- Effective per-unit price after reallocation (kept named "price" for compatibility)
  CASE WHEN qty > 0 THEN round(line_revenue / qty::numeric, 6) ELSE 0 END AS price,
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
    COALESCE((fee_rule_json->>'fixed_fee')::numeric, 0)
      / GREATEST(lines_in_order, 1)::numeric
    + line_revenue
      * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20))
      * COALESCE((fee_rule_json->>'fee_pct')::numeric, 0)
  , 4) AS channel_fee,
  fee_rule_json->>'name' AS fee_rule_name,
  round(line_revenue, 4) AS order_value,
  round(
    line_revenue - COALESCE(cost_each, 0) * qty::numeric
    - courier_full_cost / GREATEST(lines_in_order, 1)::numeric
    - (
        COALESCE((fee_rule_json->>'fixed_fee')::numeric, 0)
          / GREATEST(lines_in_order, 1)::numeric
        + line_revenue
          * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20))
          * COALESCE((fee_rule_json->>'fee_pct')::numeric, 0)
      )
  , 4) AS profit,
  CASE
    WHEN line_revenue > 0 AND qty > 0 THEN round(
      (
        line_revenue - COALESCE(cost_each, 0) * qty::numeric
        - courier_full_cost / GREATEST(lines_in_order, 1)::numeric
        - (
            COALESCE((fee_rule_json->>'fixed_fee')::numeric, 0)
              / GREATEST(lines_in_order, 1)::numeric
            + line_revenue
              * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20))
              * COALESCE((fee_rule_json->>'fee_pct')::numeric, 0)
          )
      ) / NULLIF(line_revenue * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20)), 0)
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