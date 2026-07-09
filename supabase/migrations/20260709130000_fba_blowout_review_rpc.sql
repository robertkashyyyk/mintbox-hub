-- The "fruits of our labour" review list: Amazon liquidation campaigns (blow-outs) with progress
-- — current FBA on-hand (draining), units sold + realised loss since the blow-out, and status.
-- (Applied to prod 2026-07-09 via MCP apply_migration; file added for repo parity.)
CREATE OR REPLACE FUNCTION public.get_fba_blowout_review()
RETURNS TABLE(
  sku text, blown_out_at timestamptz, campaign_price numeric, original_price numeric,
  status text, on_hand_now bigint, units_sold_since numeric, realised_loss_since numeric, never_fba boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
AS $$
  WITH linv AS (SELECT marketplace_id, max(snapshot_date) d FROM amazon.fba_inventory_snapshot GROUP BY 1),
  camp AS (
    SELECT c.sku, c.campaign_price, c.original_price, c.created_at, c.reverted_at, c.status
    FROM price_campaigns c
    WHERE c.type = 'liquidation' AND 'amazon' = ANY(c.channels)
  ),
  econ AS (
    SELECT amazon.base_sku(camp.sku) AS base_sku, sum(e.qty) AS units, sum(e.profit) AS profit
    FROM camp
      JOIN public.v_fba_order_economics e ON e.sku = amazon.base_sku(camp.sku) AND e.order_date >= camp.created_at
    GROUP BY amazon.base_sku(camp.sku)
  )
  SELECT camp.sku, camp.created_at, camp.campaign_price, camp.original_price,
    CASE WHEN camp.reverted_at IS NOT NULL THEN 'reverted'
         WHEN camp.status = 'active' THEN 'clearing'
         ELSE camp.status END,
    (SELECT sum(fi.afn_fulfillable_quantity)
       FROM amazon.fba_inventory_snapshot fi
         JOIN linv ON linv.marketplace_id = fi.marketplace_id AND linv.d = fi.snapshot_date
         JOIN amazon.esagu_item e2 ON e2.marketplace_id = fi.marketplace_id AND e2.asin = fi.asin AND e2.catalogue_sku = camp.sku),
    COALESCE(ec.units, 0), COALESCE(ec.profit, 0),
    EXISTS(SELECT 1 FROM amazon.fba_switch_exclusions x WHERE x.sku = camp.sku)
  FROM camp
    LEFT JOIN econ ec ON ec.base_sku = amazon.base_sku(camp.sku)
  ORDER BY camp.created_at DESC
$$;
REVOKE ALL ON FUNCTION public.get_fba_blowout_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fba_blowout_review() TO authenticated, service_role;
