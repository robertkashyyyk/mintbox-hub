-- products_cache columns
ALTER TABLE public.products_cache
  ADD COLUMN IF NOT EXISTS on_order numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_alert numeric,
  ADD COLUMN IF NOT EXISTS low_stock_alert_synced_at timestamptz;

-- suppliers: add fields
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS lead_time_days integer DEFAULT 7,
  ADD COLUMN IF NOT EXISTS mintsoft_supplier_id integer;

-- brands: link to default supplier
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS default_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- purchase_orders: extras
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS po_number text UNIQUE,
  ADD COLUMN IF NOT EXISTS mintsoft_po_id integer,
  ADD COLUMN IF NOT EXISTS warehouse_id integer,
  ADD COLUMN IF NOT EXISTS total_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_by uuid,
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON public.purchase_orders(supplier_id);

-- purchase_order_lines: snapshots + line_total
ALTER TABLE public.purchase_order_lines
  ADD COLUMN IF NOT EXISTS snapshot_live_stock numeric,
  ADD COLUMN IF NOT EXISTS snapshot_on_order numeric,
  ADD COLUMN IF NOT EXISTS snapshot_back_orders numeric,
  ADD COLUMN IF NOT EXISTS snapshot_low_stock_alert numeric,
  ADD COLUMN IF NOT EXISTS notes text;

-- generated line_total based on existing qty_ordered & unit_cost
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_order_lines' AND column_name='line_total'
  ) THEN
    EXECUTE 'ALTER TABLE public.purchase_order_lines
             ADD COLUMN line_total numeric GENERATED ALWAYS AS (qty_ordered * COALESCE(unit_cost, 0)) STORED';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_po_lines_po ON public.purchase_order_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_sku ON public.purchase_order_lines(sku);

-- App setting for live warehouse
INSERT INTO public.app_settings (key, value, description)
VALUES ('ordering.live_warehouse_id', '5'::jsonb, 'Mintsoft Warehouse ID for the live (Coleraine) warehouse used for purchasing decisions')
ON CONFLICT (key) DO NOTHING;