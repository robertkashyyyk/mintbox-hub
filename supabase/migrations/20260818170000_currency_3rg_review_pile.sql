-- 3RG currency review pile: user confirmed the manual/ambiguous-source 3RG costs are
-- correct NATIVE EUR (Mintsoft holds native; hub was mislabelled GBP). Convert the
-- remaining unconverted 3RG rows (the ~30 the FA1-style remap 20260818160000 left in
-- the review pile) — Mintsoft unchanged, hub = native × 0.8636. Applied live 2026-08-18.
ALTER TABLE public.products_cache DISABLE TRIGGER trg_apply_cost_currency;
UPDATE public.products_cache
SET cost_price_native   = cost_price,
    cost_price_currency = 'EUR',
    cost_fx_rate        = 0.8636,
    cost_price          = round(cost_price * 0.8636, 4)
WHERE sku LIKE '3RG-%' AND cost_price_native IS NULL AND cost_price IS NOT NULL;
ALTER TABLE public.products_cache ENABLE TRIGGER trg_apply_cost_currency;
