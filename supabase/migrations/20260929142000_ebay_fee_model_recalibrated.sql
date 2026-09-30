-- Recalibrate the eBay fee model per store from 90d actual final_value_fee (ex-VAT) vs line
-- revenue (regr slope=fee_pct, intercept=fixed; r 0.97-0.99). vat_rate=0 (ex-VAT, reclaimable).
-- Higher priority (lower number) than the Default rule so eBay stores match these first.
-- This is the model FALLBACK; primary eBay actual-fee-per-line is staged separately (needs the
-- order_line_economics matview recreate). At r~0.99 this model is aggregate-unbiased vs actuals.
insert into channel_fee_rules (name, channel_pattern, fee_pct, fixed_fee, vat_rate, priority, active) values
  ('eBay CPI (actuals 90d)',          'eBay - CPI',           0.1205, 0.395, 0, 20, true),
  ('eBay ASC (actuals 90d)',          'eBay - ASC',           0.1237, 0.408, 0, 20, true),
  ('eBay Universal (actuals 90d)',    'eBay - Universal',     0.1227, 0.361, 0, 20, true),
  ('eBay 123 Autocare (actuals 90d)', 'eBay - 123 Autocare',  0.1280, 0.372, 0, 20, true),
  ('eBay Stop Shop (actuals 90d)',    'eBay - The Stop Shop', 0.1349, 0.237, 0, 20, true)
on conflict do nothing;