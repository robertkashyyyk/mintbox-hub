-- "Stuck at FBA" blow-out worklist: FBA items where we hold on-hand stock, we do NOT win the
-- Buy Box, and matching the Buy Box price would be below our break-even floor (winning it is a
-- loss). Independent of the never-FBA flag (the stock sits there regardless). Excludes items
-- already on clearance or on an active Amazon liquidation campaign. Buy Box truth from
-- esagu_buybox_snapshot.we_win (A18KNZ0ID7MNQY = our own seller id).
-- (Applied to prod 2026-07-09 via MCP apply_migration; file added for repo parity.)
CREATE OR REPLACE FUNCTION public.get_fba_blowout_candidates()
RETURNS TABLE(
  sku text, asin text, product_name text, marketplace_id text,
  on_hand bigint, inbound bigint, cost numeric, breakeven_floor numeric,
  buy_box_price numeric, buy_box_seller text, our_price numeric, loss_per_unit numeric,
  capital_at_cost numeric, weekly_velocity numeric, never_fba boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
AS $$
  WITH lbb AS (SELECT max(snapshot_date) d FROM amazon.esagu_buybox_snapshot),
  linv AS (SELECT marketplace_id, max(snapshot_date) d FROM amazon.fba_inventory_snapshot GROUP BY 1),
  inv AS (
    SELECT fi.marketplace_id, fi.asin,
           sum(fi.afn_fulfillable_quantity) AS on_hand,
           sum(fi.afn_inbound_working_quantity + fi.afn_inbound_shipped_quantity + fi.afn_inbound_receiving_quantity) AS inbound,
           min(fi.product_name) AS product_name
    FROM amazon.fba_inventory_snapshot fi
      JOIN linv ON linv.marketplace_id = fi.marketplace_id AND linv.d = fi.snapshot_date
    GROUP BY 1, 2
  ),
  bb AS (
    SELECT DISTINCT ON (s.catalogue_sku)
      s.catalogue_sku, s.asin, s.marketplace_id, s.buy_box_price, s.buy_box_seller, s.our_price, s.on_clearance
    FROM amazon.esagu_buybox_snapshot s
      JOIN lbb ON s.snapshot_date = lbb.d
    WHERE s.fba AND NOT COALESCE(s.we_win, false) AND s.buy_box_price IS NOT NULL
    ORDER BY s.catalogue_sku, s.buy_box_price ASC
  )
  SELECT bb.catalogue_sku, bb.asin, COALESCE(i.product_name, pc.name), bb.marketplace_id,
    COALESCE(i.on_hand, 0::bigint), COALESCE(i.inbound, 0::bigint), pc.cost_price,
    public.esagu_break_even_floor(pc.cost_price, true),
    bb.buy_box_price, bb.buy_box_seller, bb.our_price,
    round(bb.buy_box_price - public.esagu_break_even_floor(pc.cost_price, true), 2),
    round(COALESCE(i.on_hand, 0::bigint) * pc.cost_price, 2),
    vv.weekly_velocity,
    (x.sku IS NOT NULL)
  FROM bb
    JOIN products_cache pc ON pc.sku = bb.catalogue_sku
    LEFT JOIN inv i ON i.marketplace_id = bb.marketplace_id AND i.asin = bb.asin
    LEFT JOIN amazon.v_fba_velocity vv ON vv.marketplace_id = bb.marketplace_id AND vv.base_sku = amazon.base_sku(bb.catalogue_sku)
    LEFT JOIN amazon.fba_switch_exclusions x ON x.sku = bb.catalogue_sku
  WHERE pc.cost_price > 0
    AND public.esagu_break_even_floor(pc.cost_price, true) > bb.buy_box_price
    AND COALESCE(i.on_hand, 0::bigint) > 0
    AND NOT COALESCE(bb.on_clearance, false)
    AND NOT EXISTS (SELECT 1 FROM price_campaigns pcm WHERE pcm.sku = bb.catalogue_sku AND pcm.type = 'liquidation' AND 'amazon' = ANY(pcm.channels) AND pcm.status = 'active')
  ORDER BY round(COALESCE(i.on_hand, 0::bigint) * pc.cost_price, 2) DESC
$$;
REVOKE ALL ON FUNCTION public.get_fba_blowout_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fba_blowout_candidates() TO authenticated, service_role;
