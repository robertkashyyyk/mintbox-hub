-- Create table for storing your eBay seller usernames
CREATE TABLE public.ebay_seller_usernames (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for caching eBay search results
CREATE TABLE public.ebay_search_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand TEXT NOT NULL,
  model_part_number TEXT NOT NULL,
  search_key TEXT NOT NULL UNIQUE, -- combination of brand + model for quick lookup
  cheapest_overall_price NUMERIC,
  cheapest_overall_item_id TEXT,
  cheapest_overall_url TEXT,
  cheapest_own_price NUMERIC,
  cheapest_own_item_id TEXT,
  cheapest_own_url TEXT,
  compatibility_data JSONB, -- vehicle fitment info
  compatibility_item_id TEXT,
  seo_titles TEXT[], -- array of AI-generated titles
  searched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ebay_seller_usernames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebay_search_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ebay_seller_usernames
CREATE POLICY "Authenticated users can view seller usernames"
  ON public.ebay_seller_usernames
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Super users can manage seller usernames"
  ON public.ebay_seller_usernames
  FOR ALL
  USING (has_role(auth.uid(), 'super_user'::app_role));

-- RLS Policies for ebay_search_cache
CREATE POLICY "Authenticated users can view search cache"
  ON public.ebay_search_cache
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert search cache"
  ON public.ebay_search_cache
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update search cache"
  ON public.ebay_search_cache
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Add trigger for updated_at on ebay_seller_usernames
CREATE TRIGGER update_ebay_seller_usernames_updated_at
  BEFORE UPDATE ON public.ebay_seller_usernames
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Create index for faster searches
CREATE INDEX idx_ebay_search_cache_key ON public.ebay_search_cache(search_key);
CREATE INDEX idx_ebay_search_cache_expires ON public.ebay_search_cache(expires_at);