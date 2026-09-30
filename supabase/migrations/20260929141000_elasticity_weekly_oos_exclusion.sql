-- Flag out-of-stock weeks in elasticity_weekly (same treatment as on_campaign) so the
-- proposer can exclude weeks where demand was constrained by no stock. Applied live via MCP.
alter table public.elasticity_weekly add column if not exists out_of_stock boolean not null default false;

create or replace function public.refresh_elasticity_weekly()
 returns void language sql security definer set search_path to 'public'
as $function$
  INSERT INTO elasticity_weekly (sku, channel, iso_year, iso_week, week_start, units, revenue, profit, avg_cost, avg_price, on_campaign, out_of_stock)
  SELECT g.sku, g.channel, g.iso_year, g.iso_week, g.week_start, g.units, g.revenue, g.profit, g.avg_cost, g.avg_price,
         EXISTS (
           SELECT 1 FROM price_campaigns pc
           WHERE pc.sku = g.sku AND pc.type IN ('liquidation','sale','promo')
             AND COALESCE(pc.start_date,'2000-01-01') <= g.week_start + 6
             AND COALESCE(pc.end_date, current_date) >= g.week_start
             AND ((lower(g.channel) LIKE 'ebay%'   AND 'ebay'   = ANY(pc.channels))
               OR (lower(g.channel) LIKE 'amazon%' AND 'amazon' = ANY(pc.channels)))
         ) AS on_campaign,
         COALESCE((
           SELECT max(ss.on_hand) <= 0
           FROM stock_snapshot ss
           WHERE ss.sku = g.sku
             AND ss.snapshot_date >= g.week_start AND ss.snapshot_date <= g.week_start + 6
         ), false) AS out_of_stock
  FROM (
    SELECT ole.sku, ole.channel, ole.iso_year, ole.iso_week, MIN(ole.week_start) AS week_start,
           SUM(ole.qty) AS units, ROUND(SUM(ole.order_value),2) AS revenue, ROUND(SUM(ole.profit),2) AS profit,
           ROUND(SUM(ole.cost_each*ole.qty)/NULLIF(SUM(ole.qty),0),4) AS avg_cost,
           ROUND(SUM(ole.order_value)/NULLIF(SUM(ole.qty),0),4) AS avg_price
    FROM order_line_economics ole
    WHERE ole.sku IS NOT NULL AND ole.channel IS NOT NULL
      AND ole.order_date >= now() - interval '21 days'
    GROUP BY ole.sku, ole.channel, ole.iso_year, ole.iso_week
  ) g
  ON CONFLICT (sku, channel, iso_year, iso_week) DO UPDATE
    SET week_start=excluded.week_start, units=excluded.units, revenue=excluded.revenue,
        profit=excluded.profit, avg_cost=excluded.avg_cost, avg_price=excluded.avg_price,
        on_campaign=excluded.on_campaign, out_of_stock=excluded.out_of_stock;
$function$;
