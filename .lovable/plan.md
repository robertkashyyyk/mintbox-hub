

# Order Telemetry — Operational Handoff & Historical Backfill

## Summary

Three workstreams: (1) set up cron jobs and backfill logic, (2) clean up old data and enforce date boundary, (3) complete the operational action loop with suggested actions, resolve outcomes, and run the issue evaluator.

---

## 1. Cron Jobs & Backfill Sync

**Hourly sync (on the hour):** Create a cron job calling `sync-mintsoft-orders` every hour with a 7-day lookback. This keeps current orders fresh.

**Half-hour backfill cron:** Create a second cron job at `:30` calling `sync-mintsoft-orders` with a special `backfill: true` mode. The function will:
- Accept `backfill: true` in the request body
- Use a new `backfill_cursor` row in `ingest_run_state` to track progress (starting from today, working backward to 2026-01-01)
- Fetch only 50 orders per run (small batch to avoid timeouts)
- Move the cursor backward each run until it reaches 2026-01-01, then stop
- This will progressively fill the gap over ~hours without manual intervention

**Files modified:** `sync-mintsoft-orders/index.ts`, plus two `cron.schedule` SQL inserts.

---

## 2. Data Cleanup & Date Boundary

**Delete pre-2026 data:** Remove the 85 order lines with `order_date < 2026-01-01` (via insert tool SQL).

**Enforce boundary in sync:** Update `sync-mintsoft-orders` to hard-code `2026-01-01` as the earliest allowed date — any order older than this is skipped regardless of the `fromDate` parameter.

**Enforce boundary in UI:** Update `useOrderTelemetry` to filter `order_date >= 2026-01-01` in the query.

---

## 3. Operational Action Loop (Detect → Understand → Act → Resolve)

### 3a. Add `suggested_action` column to `order_issues`
Migration to add a `text` column `suggested_action` to `order_issues`. The evaluate function already computes this — it just needs to persist it.

### 3b. Update `evaluate-order-issues` to store `suggested_action`
Include `suggested_action` in both insert and update payloads so it's saved in the database.

### 3c. Expand resolve outcomes in `OrderDetail.tsx`
Update the resolve button options to match the operational vocabulary:
- Stock Adjusted
- Moved to Backorder
- Supplier Ordered
- Found and Picked
- False Positive
- Order Cancelled

### 3d. Display `suggested_action` from database in detail panel
Read `suggested_action` from the issue record instead of the hardcoded map (fall back to map if not stored).

### 3e. Add `suggested_action` to the enriched line type
Expose it through `useOrderTelemetry` so the table can show a truncated version inline.

---

## 4. Run the Issue Evaluator

After deploying, manually trigger `evaluate-order-issues` to populate the `order_issues` table (currently 0 rows). This will immediately populate the "Needs Action Now" view.

Add `evaluate-order-issues` to `config.toml` with `verify_jwt = false` so crons can call it.

Set up a cron to run evaluation every hour at `:05` (5 minutes after the sync).

---

## 5. Status Visibility Fix

159 order lines have `NULL` status. The evaluate function already excludes terminal/backorder statuses correctly. The `ONBACKORDER` and `AWAITINGPICKING` values (no spaces) are already handled by the `OrderStatusBadge` component. No further changes needed — statuses are working.

---

## Files Changed

| File | Change |
|---|---|
| `sync-mintsoft-orders/index.ts` | Add backfill mode, enforce 2026-01-01 boundary |
| `evaluate-order-issues/index.ts` | Persist `suggested_action` in DB |
| `src/hooks/useOrderTelemetry.ts` | Add `suggested_action` to enriched type, filter ≥ 2026-01-01 |
| `src/components/orders/OrderDetail.tsx` | Use DB `suggested_action`, update resolve outcomes |
| `supabase/config.toml` | Add `evaluate-order-issues` with `verify_jwt = false` |
| Migration | Add `suggested_action` text column to `order_issues` |
| SQL inserts | 3 cron jobs (hourly sync, half-hour backfill, evaluation at :05), delete pre-2026 data |

