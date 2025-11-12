-- Create barcode types enum for extensibility
CREATE TABLE IF NOT EXISTS public.barcode_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_name text NOT NULL UNIQUE,
  digit_count integer,
  created_at timestamp with time zone DEFAULT now()
);

-- Insert default barcode types
INSERT INTO public.barcode_types (type_name, digit_count) VALUES
  ('UPC', 12),
  ('EAN', 13),
  ('Other', NULL)
ON CONFLICT (type_name) DO NOTHING;

-- Create product categories table for tag system
CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now()
);

-- Create products cache table
CREATE TABLE IF NOT EXISTS public.products_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  barcode text,
  barcode_type_id uuid REFERENCES public.barcode_types(id),
  discontinued boolean DEFAULT false,
  suppliers text,
  low_stock_alert_level numeric DEFAULT 0,
  weight numeric,
  height numeric,
  length numeric,
  depth numeric,
  cost_price numeric,
  handling_time integer,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create junction table for product categories (many-to-many)
CREATE TABLE IF NOT EXISTS public.product_category_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products_cache(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.product_categories(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(product_id, category_id)
);

-- Enable RLS on all tables
ALTER TABLE public.barcode_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_category_links ENABLE ROW LEVEL SECURITY;

-- RLS policies for barcode_types (read-only for authenticated users)
CREATE POLICY "Anyone can view barcode types"
  ON public.barcode_types FOR SELECT
  USING (true);

-- RLS policies for product_categories
CREATE POLICY "Anyone can view product categories"
  ON public.product_categories FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can manage categories"
  ON public.product_categories FOR ALL
  USING (auth.role() = 'authenticated');

-- RLS policies for products_cache
CREATE POLICY "Anyone can view products cache"
  ON public.products_cache FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can manage products cache"
  ON public.products_cache FOR ALL
  USING (auth.role() = 'authenticated');

-- RLS policies for product_category_links
CREATE POLICY "Anyone can view product category links"
  ON public.product_category_links FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can manage product category links"
  ON public.product_category_links FOR ALL
  USING (auth.role() = 'authenticated');

-- Add trigger for updated_at on products_cache
CREATE TRIGGER update_products_cache_updated_at
  BEFORE UPDATE ON public.products_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Create index for faster SKU lookups
CREATE INDEX IF NOT EXISTS idx_products_cache_sku ON public.products_cache(sku);
CREATE INDEX IF NOT EXISTS idx_product_category_links_product ON public.product_category_links(product_id);
CREATE INDEX IF NOT EXISTS idx_product_category_links_category ON public.product_category_links(category_id);