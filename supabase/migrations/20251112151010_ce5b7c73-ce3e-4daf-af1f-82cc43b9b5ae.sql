-- Remove the api_key column from mintsoft_settings
-- The MINTSOFT_API_KEY secret will be used instead
ALTER TABLE public.mintsoft_settings DROP COLUMN IF EXISTS api_key;