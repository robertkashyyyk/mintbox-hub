-- Standardise carrier-format weight thresholds to KILOGRAMS, matching the rest of
-- the app (products_cache.weight is the raw Mintsoft value, which is in kg).
--
-- Previously carrier_format_services.max_weight_g held grams (e.g. 750, 5000). With
-- product weight in kg, any future "classify measured item into postal format" logic
-- would have compared kg against grams and been wrong by 1000x. Converting the column
-- to kg now removes that hazard entirely — the whole system is kg end to end.
ALTER TABLE public.carrier_format_services
  RENAME COLUMN max_weight_g TO max_weight_kg;

-- Convert existing thresholds: 750g -> 0.75kg, 5000g -> 5kg. NULLs stay NULL.
UPDATE public.carrier_format_services
  SET max_weight_kg = max_weight_kg / 1000.0
  WHERE max_weight_kg IS NOT NULL;
