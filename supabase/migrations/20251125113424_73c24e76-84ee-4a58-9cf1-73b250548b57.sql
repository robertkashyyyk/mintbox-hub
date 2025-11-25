-- Add base_multiplier column to brands table
ALTER TABLE public.brands
ADD COLUMN base_multiplier numeric;

-- Create view for brands missing base multiplier
CREATE OR REPLACE VIEW public.brands_missing_base_multiplier AS
SELECT *
FROM public.brands
WHERE base_multiplier IS NULL;