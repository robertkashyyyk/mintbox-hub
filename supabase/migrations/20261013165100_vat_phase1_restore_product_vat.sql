-- VAT Phase 1 (2026-10-13). channel_fee_rules.vat_rate is PRODUCT (output) VAT, used to gross
-- ex-VAT revenue up to the VAT-inclusive price marketplace fees are charged on, and in floor
-- maths as 1/(1+vat). The 29 Sep fee-VAT change set it to 0, treating it as VAT on the fee.
-- Restore 0.20 everywhere. The five per-store eBay rules were fitted on NET revenue
-- (fee_exvat = fee_pct*net + fixed), so re-express fee_pct on the gross basis (/1.2): the
-- modelled eBay fee net*1.2*(fee_pct/1.2) is unchanged. Amazon 0.15 and Default 0.12 already
-- are gross-basis rates. Rollback source: fee_vat_rebase.channel_fee_rules_2026_10_13.
update public.channel_fee_rules
   set fee_pct = round(fee_pct / 1.2, 6), updated_at = now(),
       notes = coalesce(notes || ' | ', '') || '2026-10-13 VAT Phase 1: fee_pct restated on gross basis (was ' || fee_pct || ' of net)'
 where priority = 20 and name like 'eBay % (actuals 90d)';

update public.channel_fee_rules
   set vat_rate = 0.20, updated_at = now()
 where vat_rate is distinct from 0.20;

insert into public.audit_log (entity_type, entity_id, action_type, old_value, new_value)
select 'channel_fee_rules', r.id::text, 'vat_phase1_restore',
       jsonb_build_object('vat_rate', s.vat_rate, 'fee_pct', s.fee_pct),
       jsonb_build_object('vat_rate', r.vat_rate, 'fee_pct', r.fee_pct)
from public.channel_fee_rules r join fee_vat_rebase.channel_fee_rules_2026_10_13 s on s.id = r.id;
