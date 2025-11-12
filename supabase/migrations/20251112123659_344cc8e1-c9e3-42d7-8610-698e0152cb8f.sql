-- Add stock tracking columns to products_cache
ALTER TABLE public.products_cache
ADD COLUMN IF NOT EXISTS current_stock numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS back_order_qty numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS on_order numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_stock_sync timestamp with time zone;

-- Create index for faster stock queries
CREATE INDEX IF NOT EXISTS idx_products_cache_stock ON public.products_cache(current_stock, low_stock_alert_level);

-- Add a view for products that need ordering
CREATE OR REPLACE VIEW public.products_need_ordering AS
SELECT 
  id,
  sku,
  name,
  current_stock,
  back_order_qty,
  on_order,
  low_stock_alert_level,
  -- Calculate quantity to order
  GREATEST(
    back_order_qty + GREATEST(low_stock_alert_level - current_stock, 0) - on_order,
    0
  ) as quantity_to_order,
  last_stock_sync
FROM public.products_cache
WHERE 
  -- Item needs ordering if calculation is > 0
  GREATEST(
    back_order_qty + GREATEST(low_stock_alert_level - current_stock, 0) - on_order,
    0
  ) > 0;

-- Enable RLS on the view
ALTER VIEW public.products_need_ordering SET (security_invoker = on);

-- Grant select on the view
GRANT SELECT ON public.products_need_ordering TO authenticated;