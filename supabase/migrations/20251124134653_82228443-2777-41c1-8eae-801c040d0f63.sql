-- Add unique constraint on brand_id for price_hunter_automations
ALTER TABLE public.price_hunter_automations
ADD CONSTRAINT price_hunter_automations_brand_id_key UNIQUE (brand_id);