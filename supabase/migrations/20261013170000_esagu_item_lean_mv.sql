-- 2026-10-13: narrow, precomputed copy of amazon.esagu_item for the eSagu guards.
-- esagu_costfloor_targets / esagu_guard_targets / esagu_margin_targets each scanned the
-- wide (~63 MB, offers jsonb) mirror and unpacked offers per row, running at or over the
-- 8 s API statement timeout, so the daily guards (crons 75/76/78) failed silently.
-- The mirror only changes on the hourly sync (cron 74, :07); this MV is refreshed at :15.
create materialized view if not exists amazon.mv_esagu_item_lean as
select e.esagu_item_id, e.asin, e.catalogue_sku, e.mode, e.fba, e.quantity,
       e.min_price, e.max_price, e.amazon_price,
       -- cheapest eligible offer excluding ours (Amazon's own offer included), as the guards use it
       (select min((o->>'price')::numeric) from jsonb_array_elements(e.offers) o
         where o->>'seller' <> 'A18KNZ0ID7MNQY'
           and jsonb_array_length(coalesce(o->'excl','[]'::jsonb)) = 0
           and nullif(o->>'price','') is not null) as ext_market,
       now() as refreshed_at
from amazon.esagu_item e;

create unique index if not exists mv_esagu_item_lean_pk on amazon.mv_esagu_item_lean (esagu_item_id);
create index if not exists mv_esagu_item_lean_asin on amazon.mv_esagu_item_lean (asin);
create index if not exists mv_esagu_item_lean_sku on amazon.mv_esagu_item_lean (catalogue_sku);
analyze amazon.mv_esagu_item_lean;
