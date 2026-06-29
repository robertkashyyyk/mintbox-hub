-- Immutable per-SKU "go-live" anchor for the Repricing Payoff report.
--
-- PROBLEM: reprice-payoff derived each SKU's go-live from
-- threeds_reprice_pending.queued_at. That table is UNIQUE(store_id, sku), so a
-- re-queue OVERWRITES queued_at and moves go-live forward. The report's
-- counterfactual period = now - go-live, so re-queuing a batch of already-live
-- SKUs retroactively shrinks the cumulative counterfactual; the client renders
-- the day-over-day drop as a spurious negative "value per day" bar
-- (e.g. 28 Jun 2026 = -£326, caused by 122 SKUs re-queued on 27 Jun).
--
-- FIX: a small registry the payoff function owns. The first time a (store, SKU)
-- is seen, its anchor is recorded; later re-queues never move it. This is
-- decoupled from the operational repricer — no change to push/reconcile.

create table if not exists public.reprice_payoff_anchor (
  store_id         uuid not null references public.threeds_stores(id) on delete cascade,
  sku              text not null,
  anchor_queued_at timestamptz not null,   -- frozen go-live anchor (goLive() is applied on read)
  first_seen_at    timestamptz not null default now(),
  primary key (store_id, sku)
);

-- Backfill from the current queue.
insert into public.reprice_payoff_anchor (store_id, sku, anchor_queued_at)
select store_id, sku, queued_at
from public.threeds_reprice_pending
on conflict (store_id, sku) do nothing;

-- Recover the ORIGINAL go-live for SKUs re-queued before this migration (whose
-- queued_at was already overwritten). A SKU first appears in the auto-reprice
-- snapshots once its new price is live, so min(snapshot_date) approximates the
-- original go-live. LEAST() only ever moves an anchor EARLIER, never later, so
-- this is safe: a snapshot can't make go-live later than the recorded queued_at.
-- (Verified 2026-06-29: recovers an earlier go-live for ~183 of the ~216
-- recently re-queued SKUs, earliest 2026-06-09 — matching the original batch.)
update public.reprice_payoff_anchor a
set anchor_queued_at = least(a.anchor_queued_at, s.first_snap::timestamptz)
from (
  select store_id, sku, min(snapshot_date) as first_snap
  from public.threeds_reprice_auto_snapshots
  group by store_id, sku
) s
where s.store_id = a.store_id
  and s.sku = a.sku
  and s.first_snap::timestamptz < a.anchor_queued_at;

alter table public.reprice_payoff_anchor enable row level security;

drop policy if exists "auth read reprice_payoff_anchor" on public.reprice_payoff_anchor;
create policy "auth read reprice_payoff_anchor" on public.reprice_payoff_anchor
  for select to authenticated using (true);

drop policy if exists "service write reprice_payoff_anchor" on public.reprice_payoff_anchor;
create policy "service write reprice_payoff_anchor" on public.reprice_payoff_anchor
  for all to service_role using (true) with check (true);
