-- Create buy_recommendations view
create or replace view buy_recommendations as
select
    s.sku,
    s.brand_id,
    s.avg_weekly_units,
    s.on_hand_qty,
    s.base_multiplier,
    s.weeks_of_cover,
    (s.avg_weekly_units * (s.base_multiplier * 2)) as target_stock,
    ((s.avg_weekly_units * (s.base_multiplier * 2)) - s.on_hand_qty) as recommended_purchase_qty
from sku_stock_health s
where
    s.base_multiplier is not null
    and s.avg_weekly_units > 0
    and ((s.avg_weekly_units * (s.base_multiplier * 2)) - s.on_hand_qty) > 0
order by recommended_purchase_qty desc;