-- Add "our listings" price hunter fields to products_cache
ALTER TABLE public.products_cache
ADD COLUMN IF NOT EXISTS ph_our_best_price numeric,
ADD COLUMN IF NOT EXISTS ph_our_best_seller text,
ADD COLUMN IF NOT EXISTS ph_our_best_item_id text;

-- Create ignored_sellers table
CREATE TABLE IF NOT EXISTS public.ignored_sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_username text NOT NULL,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create ignored_listings table
CREATE TABLE IF NOT EXISTS public.ignored_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ebay_item_id text NOT NULL,
  sku text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ignored_sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ignored_listings ENABLE ROW LEVEL SECURITY;

-- RLS policies for ignored_sellers
CREATE POLICY "Authenticated users can view ignored sellers"
  ON public.ignored_sellers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert ignored sellers"
  ON public.ignored_sellers FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete ignored sellers"
  ON public.ignored_sellers FOR DELETE
  TO authenticated
  USING (true);

-- RLS policies for ignored_listings
CREATE POLICY "Authenticated users can view ignored listings"
  ON public.ignored_listings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert ignored listings"
  ON public.ignored_listings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete ignored listings"
  ON public.ignored_listings FOR DELETE
  TO authenticated
  USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ignored_sellers_username ON public.ignored_sellers(seller_username);
CREATE INDEX IF NOT EXISTS idx_ignored_sellers_brand ON public.ignored_sellers(brand_id);
CREATE INDEX IF NOT EXISTS idx_ignored_listings_item_id ON public.ignored_listings(ebay_item_id);
CREATE INDEX IF NOT EXISTS idx_ignored_listings_sku ON public.ignored_listings(sku);