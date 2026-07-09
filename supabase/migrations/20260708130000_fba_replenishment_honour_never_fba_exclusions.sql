-- The Amazon "Blow out" action flags a SKU never-FBA (amazon.fba_switch_exclusions), but
-- v_fba_replenishment never checked that list, so flagged SKUs kept getting restock recs.
-- Honour the exclusion: zero the reorder + drop replenish_flag, and append never_fba so the
-- flag is visible rather than the row silently vanishing.
-- (Applied to prod 2026-07-08 via MCP apply_migration; file added for repo parity.)
CREATE OR REPLACE VIEW amazon.v_fba_replenishment AS
WITH cfg AS (
  SELECT replenishment_config.target_weeks_cover, replenishment_config.default_moq
  FROM amazon.replenishment_config WHERE replenishment_config.id
),
inv AS (
  SELECT x.marketplace_id, amazon.base_sku(x.resolved_sku) AS base_sku,
    sum(s.afn_fulfillable_quantity * amazon.pack_size(x.resolved_sku)) AS on_hand_units,
    sum((s.afn_inbound_working_quantity + s.afn_inbound_shipped_quantity + s.afn_inbound_receiving_quantity) * amazon.pack_size(x.resolved_sku)) AS in_transit_units
  FROM amazon.fba_inventory_snapshot s
    JOIN (SELECT fba_inventory_snapshot.marketplace_id, max(fba_inventory_snapshot.snapshot_date) AS d
          FROM amazon.fba_inventory_snapshot GROUP BY fba_inventory_snapshot.marketplace_id) latest
      ON latest.marketplace_id = s.marketplace_id AND latest.d = s.snapshot_date
    JOIN amazon.v_asin_sku x ON x.marketplace_id = s.marketplace_id AND x.asin = s.asin
  WHERE x.resolved_sku IS NOT NULL
  GROUP BY x.marketplace_id, (amazon.base_sku(x.resolved_sku))
),
base AS (
  SELECT v.marketplace_id, m.country_code, v.base_sku, v.weekly_velocity, v.units_7d, v.units_30d,
    COALESCE(inv.on_hand_units, 0::bigint) AS fba_on_hand,
    COALESCE(inv.in_transit_units, 0::bigint) AS fba_in_transit,
    round(cfg.target_weeks_cover * v.weekly_velocity, 1) AS target_units,
    CASE WHEN v.weekly_velocity > 0::numeric THEN round((COALESCE(inv.on_hand_units, 0::bigint) + COALESCE(inv.in_transit_units, 0::bigint))::numeric / v.weekly_velocity, 1) ELSE NULL::numeric END AS days_of_cover_weeks,
    GREATEST(0::numeric, ceil(cfg.target_weeks_cover * v.weekly_velocity - COALESCE(inv.on_hand_units, 0::bigint)::numeric - COALESCE(inv.in_transit_units, 0::bigint)::numeric))::integer AS raw_units_to_order,
    ceil(GREATEST(0::numeric, ceil(cfg.target_weeks_cover * v.weekly_velocity - COALESCE(inv.on_hand_units, 0::bigint)::numeric - COALESCE(inv.in_transit_units, 0::bigint)::numeric)) / cfg.default_moq::numeric)::integer * cfg.default_moq AS units_to_order,
    (cfg.target_weeks_cover * v.weekly_velocity - COALESCE(inv.on_hand_units, 0::bigint)::numeric - COALESCE(inv.in_transit_units, 0::bigint)::numeric) > 0::numeric AS replenish_flag
  FROM amazon.v_fba_velocity v
    JOIN amazon.marketplace m ON m.marketplace_id = v.marketplace_id
    CROSS JOIN cfg
    LEFT JOIN inv ON inv.marketplace_id = v.marketplace_id AND inv.base_sku = v.base_sku
  WHERE v.weekly_velocity > 0::numeric
),
excl AS (
  SELECT DISTINCT amazon.base_sku(sku) AS base_sku FROM amazon.fba_switch_exclusions
)
SELECT b.marketplace_id, b.country_code, b.base_sku, b.weekly_velocity, b.units_7d, b.units_30d,
  b.fba_on_hand, b.fba_in_transit, b.target_units, b.days_of_cover_weeks,
  CASE WHEN xe.base_sku IS NOT NULL THEN 0 ELSE b.raw_units_to_order END AS raw_units_to_order,
  CASE WHEN xe.base_sku IS NOT NULL THEN 0 ELSE b.units_to_order END AS units_to_order,
  CASE WHEN xe.base_sku IS NOT NULL THEN false ELSE b.replenish_flag END AS replenish_flag,
  pc.cost_price AS unit_cost,
  round((CASE WHEN xe.base_sku IS NOT NULL THEN 0 ELSE b.units_to_order END)::numeric * pc.cost_price, 2) AS reorder_cost,
  e.avg_sell_price,
  round(e.avg_sell_price * COALESCE(e.referral_pct, 0::numeric), 2) AS referral_fee_per_unit,
  e.fba_fee_per_unit,
  CASE WHEN pc.cost_price IS NOT NULL AND e.avg_sell_price > 0::numeric THEN round(100::numeric * (e.avg_sell_price - pc.cost_price) / e.avg_sell_price, 1) ELSE NULL::numeric END AS gross_margin_pct,
  round(e.avg_sell_price - e.avg_sell_price * COALESCE(e.referral_pct, 0::numeric) - COALESCE(e.fba_fee_per_unit, 0::numeric) - pc.cost_price, 2) AS net_per_unit,
  CASE WHEN pc.cost_price IS NOT NULL AND e.avg_sell_price > 0::numeric THEN round(100::numeric * (e.avg_sell_price - e.avg_sell_price * COALESCE(e.referral_pct, 0::numeric) - COALESCE(e.fba_fee_per_unit, 0::numeric) - pc.cost_price) / e.avg_sell_price, 1) ELSE NULL::numeric END AS net_margin_pct,
  (xe.base_sku IS NOT NULL) AS never_fba
FROM base b
  LEFT JOIN products_cache pc ON pc.sku = b.base_sku
  LEFT JOIN amazon.mv_sku_economics e ON e.marketplace_id = b.marketplace_id AND e.base_sku = b.base_sku
  LEFT JOIN excl xe ON xe.base_sku = b.base_sku;
