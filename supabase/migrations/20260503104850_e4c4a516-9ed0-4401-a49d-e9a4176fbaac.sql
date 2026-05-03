DROP MATERIALIZED VIEW IF EXISTS public.sku_velocity CASCADE;

CREATE MATERIALIZED VIEW public.sku_velocity AS
SELECT
  ol.sku,
  pc.brand_id,
  sum(CASE WHEN ol.order_date >= (now() - interval '30 days') THEN ol.qty ELSE 0 END) AS units_30d,
  sum(CASE WHEN ol.order_date >= (now() - interval '60 days') THEN ol.qty ELSE 0 END) AS units_60d,
  sum(CASE WHEN ol.order_date >= (now() - interval '90 days') THEN ol.qty ELSE 0 END) AS units_90d,
  (sum(CASE WHEN ol.order_date >= (now() - interval '90 days') THEN ol.qty ELSE 0 END))::numeric / 12.0 AS avg_weekly_units
FROM order_lines ol
LEFT JOIN products_cache pc ON pc.sku = ol.sku
GROUP BY ol.sku, pc.brand_id;

CREATE UNIQUE INDEX sku_velocity_sku_idx ON public.sku_velocity (sku);
CREATE INDEX sku_velocity_brand_idx ON public.sku_velocity (brand_id);
CREATE INDEX sku_velocity_avg_weekly_idx ON public.sku_velocity (avg_weekly_units DESC);