-- Create order_lines table to store Mintsoft order lines
CREATE TABLE IF NOT EXISTS public.order_lines (
  id                  BIGSERIAL PRIMARY KEY,
  mintsoft_order_id   INTEGER NOT NULL,
  line_index          INTEGER NOT NULL,
  sku                 TEXT NOT NULL,
  qty                 INTEGER NOT NULL,
  order_date          TIMESTAMPTZ NOT NULL,
  channel             TEXT,
  channel_order_ref   TEXT,
  warehouse_id        TEXT,
  brand_id            UUID REFERENCES public.brands(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (mintsoft_order_id, line_index)
);

-- Create index for common queries
CREATE INDEX IF NOT EXISTS idx_order_lines_brand_id ON public.order_lines(brand_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_order_date ON public.order_lines(order_date);
CREATE INDEX IF NOT EXISTS idx_order_lines_sku ON public.order_lines(sku);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Add trigger for order_lines
CREATE TRIGGER trg_order_lines_updated_at
BEFORE UPDATE ON public.order_lines
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Enable RLS
ALTER TABLE public.order_lines ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Authenticated users can view order lines"
ON public.order_lines
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Super users can manage order lines"
ON public.order_lines
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'super_user'::app_role));