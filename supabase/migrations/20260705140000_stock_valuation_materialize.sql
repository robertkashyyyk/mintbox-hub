-- /intelligence/stock-valuation timed out ("canceling statement due to statement timeout").
-- stock_valuation was a plain VIEW over 225k products_cache rows, and the page requests an
-- EXACT count + ORDER BY net_value (a computed column, no index) + offset pagination — so every
-- load fully evaluated the view and sorted 225k rows. Materialize it (indexed, nightly refresh);
-- reads/count/pagination drop to ~40ms. sku_stock_health is already a matview so the join is cheap.
-- Definition is byte-identical to the previous view; nothing depended on the view (checked).

DROP VIEW IF EXISTS public.stock_valuation;

CREATE MATERIALIZED VIEW public.stock_valuation AS
  SELECT pc.sku,
    pc.brand_id,
    b.name AS brand_name,
    COALESCE(pc.current_stock, 0::numeric) AS current_stock,
    pc.cost_price,
    COALESCE(pc.cost_price, 0::numeric) * COALESCE(pc.current_stock, 0::numeric) AS net_value,
    COALESCE(sh.health_category, 'Unknown'::text) AS health_category,
    pc.quarantined,
    pc.name ~~* '15D%'::text AS is_remote
  FROM products_cache pc
    LEFT JOIN sku_stock_health sh ON sh.sku = pc.sku
    LEFT JOIN brands b ON b.id = pc.brand_id
  WHERE COALESCE(pc.discontinued, false) = false;

CREATE UNIQUE INDEX idx_stock_valuation_sku ON public.stock_valuation(sku);
CREATE INDEX idx_stock_valuation_net_value ON public.stock_valuation(net_value);
CREATE INDEX idx_stock_valuation_brand ON public.stock_valuation(brand_id);
CREATE INDEX idx_stock_valuation_health ON public.stock_valuation(health_category);
CREATE INDEX idx_stock_valuation_flags ON public.stock_valuation(is_remote, quarantined, current_stock);
GRANT SELECT ON public.stock_valuation TO authenticated, service_role;

-- Nightly refresh (concurrent → no read lock). cron.schedule upserts by name.
SELECT cron.schedule('refresh-stock-valuation', '45 3 * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.stock_valuation');
