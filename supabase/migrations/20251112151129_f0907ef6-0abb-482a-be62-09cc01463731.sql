-- Remove the api_key column from mintsoft_settings 
-- (we use the MINTSOFT_API_KEY secret instead for better security)
ALTER TABLE public.mintsoft_settings DROP COLUMN IF EXISTS api_key;