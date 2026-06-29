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
-- NOTE: SKUs re-queued *before* this migration already lost their original
-- queued_at, so they anchor at their current (later) queued_at. Going forward
-- the anchor is frozen, so no further drift. If the original go-live for those
-- needs recovering, min(snapshot_date) per (store_id, sku) in
-- threeds_reprice_auto_snapshots is an approximate source for a one-off update.
insert into public.reprice_payoff_anchor (store_id, sku, anchor_queued_at)
select store_id, sku, queued_at
from public.threeds_reprice_pending
on conflict (store_id, sku) do nothing;

alter table public.reprice_payoff_anchor enable row level security;

drop policy if exists "auth read reprice_payoff_anchor" on public.reprice_payoff_anchor;
create policy "auth read reprice_payoff_anchor" on public.reprice_payoff_anchor
  for select to authenticated using (true);

drop policy if exists "service write reprice_payoff_anchor" on public.reprice_payoff_anchor;
create policy "service write reprice_payoff_anchor" on public.reprice_payoff_anchor
  for all to service_role using (true) with check (true);
