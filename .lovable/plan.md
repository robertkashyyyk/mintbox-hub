

# Order Telemetry — Refinement & Calibration

## 1. Status Filter Fix (Blocking)

**Root cause:** The filter chips use human-readable labels (`"New"`, `"Awaiting Picking"`, `"On Back Order"`) but the database stores Mintsoft's raw values (`NEW`, `AWAITINGPICKING`, `ONBACKORDER`, `DESPATCHED`, `PICKED`).

Line 264 in `useOrderTelemetry.ts` does an exact match: `l.order_status === filters.orderStatus`, which never matches.

**Fix:**
- Update the `statusChips` array in `OrderFilters.tsx` to use actual DB values as the filter value, with a display label mapping
- Update the chip rendering to show friendly names but filter on raw values
- Values: `NEW`, `AWAITINGPICKING`, `ONBACKORDER`, `DESPATCHED`, `CANCELLED`, `PICKED`

**Files:** `src/components/orders/OrderFilters.tsx`

---

## 2. New Stuck Threshold Adjustment

Current thresholds in `evaluate-order-issues/index.ts` line 163: `[4, 12, 24]` (watch/problem/critical).

**Change to:** `[24, 36, 48]`
- < 24h → no flag
- 24–36h → Watch
- 36–48h → Problem
- 48h+ → Critical

Also update the `recentChange` grace window (line 159, currently 8h) — this still makes sense as the backorder recovery grace period.

**Files:** `supabase/functions/evaluate-order-issues/index.ts`

---

## 3. Backorder Awareness

**Database migration:** Add two columns to `order_lines`:
- `was_backordered boolean NOT NULL DEFAULT false`
- `last_backordered_at timestamptz`

**Sync function (`sync-mintsoft-orders`):** When upserting an order line, if the previous status was `ONBACKORDER` and the new status is not, set `was_backordered = true` and `last_backordered_at = now()`.

**Evaluation function:** Before applying `new_stuck` rule, check if `was_backordered = true` and `last_backordered_at` is within the last 8 hours. If so, skip flagging (grace period).

**UI (`OrderTable.tsx`):** Show a small "Recovered from BO" badge next to the status when `was_backordered` is true and `last_backordered_at` is recent.

**Files:** Migration, `sync-mintsoft-orders/index.ts`, `evaluate-order-issues/index.ts`, `src/components/orders/OrderTable.tsx`, `src/hooks/useOrderTelemetry.ts` (add fields to type)

---

## 4. times_seen Reset

Run a data update (via insert tool) to reset `times_seen = 1` for all order lines. This clears the inflated counts from bulk import. Future hourly syncs will increment accurately.

```sql
UPDATE order_lines SET times_seen = 1;
```

**Files:** Data operation only (insert tool)

---

## 5. Minor UI Improvements (included)

- Show truncated `reason` column in the table (already partially there, will verify)
- Ensure `suggested_action` is always populated via the evaluation function (already implemented, just needs the re-run after threshold changes)

---

## Execution Order

1. Migration: add `was_backordered` + `last_backordered_at` to `order_lines`
2. Data fix: reset `times_seen = 1`
3. Update `OrderFilters.tsx` — fix status chip values
4. Update `evaluate-order-issues/index.ts` — new thresholds + backorder grace
5. Update `sync-mintsoft-orders/index.ts` — track backorder history
6. Update `OrderTable.tsx` — "Recovered from BO" badge
7. Update `useOrderTelemetry.ts` — add new fields to type
8. Deploy edge functions and re-run evaluation

