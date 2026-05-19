## The Problem

Products in `products_cache` can exist without a `mintsoft_product_id` (we call these "orphans"). When that happens:
- Cost edits silently fail to push to Mintsoft
- Stock syncs skip them
- LSA pushes skip them
- Missing Costs / enrichment workflows treat them as uneditable dead weight

A "true SKU" (`XXX-...` or `XXX/...` — three alphanumerics + separator) is one we **should** be able to resolve against Mintsoft's catalogue via `GET /api/Product/Search?SKU=...`. If we resolve it, we backfill `mintsoft_product_id` and the SKU rejoins normal operations.

## The Plan

### 1. Classification — define what "orphan" means in SQL

Add a database view `vw_orphan_skus` that filters `products_cache` to rows where:
- `mintsoft_product_id IS NULL`
- `sku` matches the true-SKU regex `^[A-Z0-9]{3}[-/]`
- `quarantined_at IS NULL` (skip dirt SKUs — they're a separate problem)
- Not discontinued

This becomes the single source of truth for "things we should be trying to resolve".

### 2. Resolver edge function — `mintsoft-resolve-orphan-skus`

A new edge function that:
1. Pulls a batch (default 100) of orphans from `vw_orphan_skus`, oldest-checked first
2. For each SKU, calls `GET /api/Product/Search?SKU={sku}&ClientId=3` against Mintsoft
3. On exact match → updates `products_cache.mintsoft_product_id` + sets `mintsoft_resolved_at = now()`
4. On no match → bumps `mintsoft_resolve_attempts` and sets `last_mintsoft_resolve_attempt_at`
5. Writes a summary row to `agent_runs` (type `resolve_orphan_skus`)

New columns on `products_cache`:
- `mintsoft_resolved_at timestamptz`
- `last_mintsoft_resolve_attempt_at timestamptz`
- `mintsoft_resolve_attempts int default 0`

Re-check cadence: a SKU is re-tried at most once every 7 days, unless manually requeued. After 5 failed attempts it's flagged as "persistently unresolved" so we stop hammering it.

### 3. Scheduling — pg_cron, conservative

Run the resolver every **6 hours**, batch size 200. That clears ~800 SKUs/day without putting any real load on Mintsoft. The cron is master-toggleable via `app_settings` key `orphan_sku_resolver.enabled` (default on) so you can pause it instantly if needed.

### 4. Housekeeping UI — `/housekeeping/orphan-skus`

A new page slotted into the existing Housekeeping module (sits naturally next to Missing Costs / Dirt SKUs). Shows:

- **Counts strip**: Total orphans · True-SKU orphans · Resolvable today · Persistently unresolved · Last resolver run
- **Table** of orphan SKUs with columns: SKU · Brand · Title · Attempts · Last attempt · Last error · Actions
- **Filters**: brand, attempt count, "never tried" vs "tried & failed"
- **Row actions**: Retry now (single SKU), Mark as ignore (won't be retried)
- **Bulk actions**: Retry selected, Retry all in filter
- **Manual entry box**: Paste a SKU, click Resolve Now — useful for one-off fixes like `ASC-TUB-29-PV`

### 5. Surfacing it elsewhere

- **Product Detail page** — add a small badge "Not linked to Mintsoft" + a "Try to resolve" button when `mintsoft_product_id` is null
- **Missing Costs** (already done today) — orphans excluded from the list, but add a small footer count "X SKUs hidden — not linked to Mintsoft → fix in Housekeeping"
- **Housekeeping index counter** — live count of orphan SKUs alongside the other to-do counts

### 6. Safety rails

- Resolver only writes `mintsoft_product_id` on **exact SKU match** from Mintsoft — never fuzzy
- Master kill switch in `app_settings`
- Hard cap 1000 SKUs per run
- Full audit trail in `agent_runs` + per-SKU attempt history
- Mintsoft API rate-limited at 5 req/sec with backoff

## What it gives you

- Self-healing catalogue: SKUs that get added to Mintsoft after we discovered them locally will auto-link within hours
- Clear visibility of what's broken and why
- Zero more silent failures like ASC-TUB-29-PV
- An audit trail you can show Nathaniel & Clive

## Files to create/modify

**New**
- `supabase/functions/mintsoft-resolve-orphan-skus/index.ts`
- `src/pages/housekeeping/OrphanSkus.tsx`
- Migration: view + columns + cron + app_settings row

**Modified**
- `src/pages/ProductDetail.tsx` — orphan badge + manual resolve button
- `src/pages/intelligence/MissingCosts.tsx` — hidden-count footer link
- `src/pages/HousekeepingIndex.tsx` — orphan counter tile
- `docs/NAVIGATION.md` + sidebars — new route

Ready to build on approval. Want me to proceed end-to-end, or just the resolver + cron first and ship the UI second?