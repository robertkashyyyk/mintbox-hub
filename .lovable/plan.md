## 1. Brands page is slow — fix root cause

The page currently runs **57 separate `count(*)` queries** (one per brand, sequentially via `ilike`). That's the source of the lag, not a network issue.

**Fix**: replace it with one Postgres RPC `get_brands_with_product_counts()` that returns all brands + their product counts in a single round-trip using a `LEFT JOIN LATERAL` against `products_cache`. Should drop load time from ~5–15s to under 500ms.

## 2. Per-brand "Auto Update LSA" toggle

Add to the `brands` table:
- `auto_update_lsa` boolean (default false)
- `last_lsa_auto_update_at` timestamptz (for visibility)
- `last_lsa_auto_update_summary` jsonb (counts updated/failed)

In **Brands → Edit Brand dialog**: add a Switch labelled "Auto Update LSA on Mintsoft" with helper text explaining it pushes calculated Target LSA to every SKU in this brand on the configured schedule.

The Brands table will also show a small badge (`Auto LSA: On`) in a new column so you can see at a glance which brands are enrolled.

## 3. System Settings → "Auto LSA Cron"

New section in `/settings` (Systems Controllers / Super User only) with:
- **Enabled** master switch
- **Frequency**: Daily / Weekly / Monthly
- **Day of week** (when Weekly) — Mon–Sun
- **Day of month** (when Monthly) — 1–28
- **Time** — HH:MM (UK time)
- **Dry run** toggle (logs what would change without pushing)

Stored in `app_settings` under key `lsa.auto_update_schedule` as JSON.

A persistent pg_cron job runs every 15 minutes calling a new edge function `auto-update-lsa-cron`. The function:
1. Reads schedule from `app_settings`, decides if "now" is a fire window.
2. Loads all brands with `auto_update_lsa = true`.
3. For each brand, calls `get_lsa_calibration(brand_id, …)` paginated.
4. Filters to rows where `target_lsa != current_lsa` (skips dirt: quarantined, discontinued, no mintsoft id, LSA ≤ min).
5. Pushes in batches of 50 to the existing `mintsoft-update-lsa` edge function.
6. Writes summary back to `brands.last_lsa_auto_update_*` and an audit row in `agent_runs`.

## 4. Manual "Run now" button

Inside the Edit Brand dialog (when Auto Update LSA is on), a **Run Auto LSA Update Now** button that triggers the same edge function for that single brand — useful for testing the toggle without waiting for the cron.

## 5. Safety rails

- Cron is **disabled by default** until you flip the master switch in Settings.
- Per-brand toggle is also **off by default**.
- Hard cap: max 5,000 SKU updates per brand per run (logged warning if hit).
- Reuses existing `mintsoft-update-lsa` function (already battle-tested from manual LSA Calibration page).
- Full audit trail in `agent_runs` (who/when/what).

## Technical details

**New files**
- `supabase/functions/auto-update-lsa-cron/index.ts` — schedule evaluator + per-brand pusher
- `src/components/settings/AutoLsaScheduleCard.tsx` — settings UI block

**Modified files**
- `src/pages/Brands.tsx` — uses RPC, adds toggle column, adds Auto LSA fields to edit dialog
- `src/pages/Settings.tsx` — mounts new schedule card

**Migrations**
- Add columns to `brands`
- Create `get_brands_with_product_counts()` RPC
- Seed default `app_settings` row for `lsa.auto_update_schedule`
- Schedule pg_cron `auto-update-lsa-cron` every 15 minutes

Yes, all of this is possible and safe. Ready to build it on approval.