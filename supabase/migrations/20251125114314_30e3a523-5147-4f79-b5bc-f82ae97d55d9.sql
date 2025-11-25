-- Recreate view with explicit SECURITY INVOKER to resolve security warning
DROP VIEW IF EXISTS public.brands_missing_base_multiplier;

CREATE VIEW public.brands_missing_base_multiplier 
WITH (security_invoker = true) AS
SELECT *
FROM public.brands
WHERE base_multiplier IS NULL;