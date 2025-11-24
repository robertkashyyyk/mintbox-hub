-- Add fire_sale and ph_excluded columns to products_cache
ALTER TABLE public.products_cache
ADD COLUMN fire_sale boolean NOT NULL DEFAULT false,
ADD COLUMN ph_excluded boolean NOT NULL DEFAULT false;

-- Create price_hunter_automations table
CREATE TABLE public.price_hunter_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  interval_days int NOT NULL,
  include_only_in_stock boolean NOT NULL DEFAULT true,
  include_fire_sale_only boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_run_sku_count int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add RLS policies for price_hunter_automations
ALTER TABLE public.price_hunter_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view automations"
ON public.price_hunter_automations
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can manage automations"
ON public.price_hunter_automations
FOR ALL
TO authenticated
USING (true);

-- Create price_hunter_xask_usage table
CREATE TABLE public.price_hunter_xask_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products_cache(id) ON DELETE SET NULL,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  sku text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  flowline_name text NOT NULL,
  xasks_used int NOT NULL DEFAULT 1
);

-- Add RLS policies for price_hunter_xask_usage
ALTER TABLE public.price_hunter_xask_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view xask usage"
ON public.price_hunter_xask_usage
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert xask usage"
ON public.price_hunter_xask_usage
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Add trigger for updated_at on automations
CREATE TRIGGER update_price_hunter_automations_updated_at
BEFORE UPDATE ON public.price_hunter_automations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Create index for faster queries
CREATE INDEX idx_price_hunter_automations_brand_id ON public.price_hunter_automations(brand_id);
CREATE INDEX idx_price_hunter_automations_next_run ON public.price_hunter_automations(next_run_at) WHERE enabled = true;
CREATE INDEX idx_price_hunter_xask_usage_occurred_at ON public.price_hunter_xask_usage(occurred_at);
CREATE INDEX idx_price_hunter_xask_usage_brand_id ON public.price_hunter_xask_usage(brand_id);