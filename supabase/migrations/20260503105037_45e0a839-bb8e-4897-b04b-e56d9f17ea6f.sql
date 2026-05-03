CREATE OR REPLACE VIEW public.buy_recommendations AS
SELECT
    s.sku,
    s.brand_id,
    s.avg_weekly_units,
    s.on_hand_qty,
    s.base_multiplier,
    s.weeks_of_cover,
    (s.avg_weekly_units * (s.base_multiplier * 2)) AS target_stock,
    ((s.avg_weekly_units * (s.base_multiplier * 2)) - s.on_hand_qty) AS recommended_purchase_qty
FROM sku_stock_health s
WHERE s.base_multiplier IS NOT NULL
  AND s.avg_weekly_units > 0
  AND ((s.avg_weekly_units * (s.base_multiplier * 2)) - s.on_hand_qty) > 0;