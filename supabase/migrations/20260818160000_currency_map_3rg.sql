-- Extend the currency map to 3RG (Spanish/EU supplier, Mintsoft supplier ID 29, EUR).
-- Same treatment as FA1 / NBA: the Hub hadn't mapped the 3RG- prefix, so its EUR costs
-- were treated as GBP. NOTE: already applied to the live DB via SQL on 2026-08-18;
-- this file is the tracked record (idempotent — INSERT ON CONFLICT, UPDATE guarded by
-- cost_price_native IS NULL).
INSERT INTO public.supplier_currency (prefix, currency, fx_rate, note) VALUES
  ('3RG','EUR',0.8636,'3RG (supplier ID 29, EUR) — remapped like FA1')
ON CONFLICT (prefix) DO NOTHING;

-- Backfill definitely-native rows (mintsoft_sync / pack_suffix). manual_ui / null source
-- excluded (ambiguous → review pile). Trigger disabled so the GBP result isn't
-- re-interpreted as native.
ALTER TABLE public.products_cache DISABLE TRIGGER trg_apply_cost_currency;
UPDATE public.products_cache
SET cost_price_native   = cost_price,
    cost_price_currency = 'EUR',
    cost_fx_rate        = 0.8636,
    cost_price          = round(cost_price * 0.8636, 4)
WHERE sku LIKE '3RG-%'
  AND cost_price_native IS NULL
  AND cost_price IS NOT NULL
  AND (cost_price_source = 'mintsoft_sync' OR cost_price_source LIKE 'pack_suffix_correction%');
ALTER TABLE public.products_cache ENABLE TRIGGER trg_apply_cost_currency;
