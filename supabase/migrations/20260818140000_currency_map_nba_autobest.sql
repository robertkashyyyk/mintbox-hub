-- Extend the currency map to Autobest / Zhejiang Auto-Best (Chinese supplier, USD).
-- Mintsoft already labels this supplier USD (cur2); the Hub just hadn't mapped the
-- NBA- prefix, so its USD costs were being treated as GBP.

INSERT INTO public.supplier_currency (prefix, currency, fx_rate, note) VALUES
  ('NBA','USD',0.75094,'Autobest / Zhejiang Auto-Best (Chinese, USD)')
ON CONFLICT (prefix) DO NOTHING;

-- Backfill the definitely-native rows (mintsoft_sync + pack_suffix). manual_ui / (null)
-- excluded (ambiguous currency) → review pile. Trigger disabled for this statement so
-- the GBP result isn't re-interpreted as native.
ALTER TABLE public.products_cache DISABLE TRIGGER trg_apply_cost_currency;
UPDATE public.products_cache
SET cost_price_native   = cost_price,
    cost_price_currency = 'USD',
    cost_fx_rate        = 0.75094,
    cost_price          = round(cost_price * 0.75094, 4)
WHERE sku LIKE 'NBA-%'
  AND cost_price_native IS NULL
  AND cost_price IS NOT NULL
  AND (cost_price_source = 'mintsoft_sync'
       OR cost_price_source LIKE 'pack_suffix_correction%');
ALTER TABLE public.products_cache ENABLE TRIGGER trg_apply_cost_currency;
