

# Order Telemetry — Operational Monitoring Module (Phase 1, Tightened)

## Database Changes

### 1. Extend `order_lines` — add columns via migration

| Column | Type | Default | Purpose |
|---|---|---|---|
| `order_status` | text | null | Mintsoft status name |
| `order_status_id` | integer | null | Mintsoft status ID |
| `product_name` | text | null | From Mintsoft order item |
| `customer_name` | text | null | Recipient |
| `first_seen_at` | timestamptz | now() | First import |
| `last_seen_at` | timestamptz | now() | Updated each sync |
| `times_seen` | integer | 1 | Incremented each sync |
| `last_status_change_at` | timestamptz | now() | Updated when status changes |

### 2. Create `order_issues` table

Core columns: `id` (uuid PK), `mintsoft_order_id`, `line_index`, `sku`, `brand_id`, `problem_type` (text), `severity` (text), `reason` (text), `issue_status` (text default 'open'), `assigned_to` (text), `internal_notes` (text), `resolved_at` (timestamptz), `resolution_type` (text), `created_at`, `updated_at`.

**Additional columns per user feedback:**
- `first_problem_seen_at` (timestamptz, default now()) — when this issue was first detected
- `last_problem_seen_at` (timestamptz, default now()) — updated each evaluation cycle
- `is_suppressed` (boolean, default false) — manually suppress known issues
- `suppressed_until` (timestamptz, nullable) — time-bound suppression
- `suppression_reason` (text, nullable) — e.g. "waiting supplier", "intentionally parked"

Unique constraint on `(mintsoft_order_id, line_index, problem_type)`.
RLS: authenticated SELECT/INSERT/UPDATE.

## Edge Function: `sync-mintsoft-orders` — Enhanced

Current sync upserts order lines. Changes:
- Extract `OrderStatus` name/ID and `CustomerName` from the Mintsoft order object
- Extract `Name` from each order item for `product_name`
- On upsert: increment `times_seen`, update `last_seen_at`
- **Status change detection**: compare incoming `order_status_id` against stored value; if different, update `last_status_change_at` to now()
- After all lines processed, invoke `evaluate-order-issues` function

## Edge Function: `evaluate-order-issues` — New

Runs after each sync. Queries all non-dispatched `order_lines`. Applies four rules:

### Rule 1 — New Order Stuck
If `order_status` = 'New' (or status_id matches configured "new" statuses):
- Age >4h → Watch
- Age >12h → Problem  
- Age >24h → Critical

### Rule 2 — Stalled Progress (tightened)
**Not based on `times_seen` alone.** The key metric is `last_status_change_at`:
- If `last_status_change_at` is >12h ago AND order is still in an active (non-terminal) status → Watch
- >24h → Problem
- >48h → Critical

`times_seen` is used only as supporting evidence (e.g. "seen 6 times with no status change"), not as the primary trigger.

### Rule 3 — Repeated Without Progress (tightened)
Only escalates when ALL of these are true:
1. Same order+line seen across multiple snapshots (`times_seen >= 3`)
2. AND `last_status_change_at` has not moved recently (status age > 12h)
3. AND order is not in a terminal/dispatched status

This prevents false positives from legitimately open orders that are progressing normally.

### Rule 4 — SKU Clustering (advisory only)
If the same SKU appears in 3+ flagged orders in the last 48h:
- Tag those issues with `problem_type = 'stock_discrepancy_suspected'`
- Severity capped at Watch — **advisory signal only**, does not escalate existing issues
- Surfaces under a "Likely Stock Issue" toggle in the UI

### Auto-Resolution Rules
The evaluate function also runs auto-resolution logic:
1. **Dispatched**: if `order_status_id` matches a dispatched status → auto-resolve with `resolution_type = 'dispatched'`
2. **Cancelled**: if order status indicates cancellation → auto-resolve with `resolution_type = 'cancelled'`
3. **Left active feed**: if an order_line hasn't been seen in 48h+ (`last_seen_at` is stale) → auto-resolve with `resolution_type = 'left_feed'`
4. **Condition cleared**: if the problem condition no longer applies (e.g. status changed, age threshold no longer met) → auto-resolve with `resolution_type = 'condition_cleared'`

Auto-resolution sets `issue_status = 'auto_resolved'`, `resolved_at = now()`. Does NOT touch suppressed issues.

### Suppression handling
- Suppressed issues (`is_suppressed = true`) are skipped by the evaluator
- Time-bound suppression: if `suppressed_until < now()`, clear `is_suppressed` and re-evaluate
- UI provides suppress button with reason field and optional expiry

## UI — `SalesOrders.tsx` Rewrite

### Component structure
```text
src/pages/SalesOrders.tsx              — page shell, summary cards
src/components/orders/OrderFilters.tsx — toggles + filter bar
src/components/orders/OrderTable.tsx   — paginated table
src/components/orders/OrderDetail.tsx  — side panel (row click)
src/hooks/useOrderTelemetry.ts        — data fetching + client-side filtering
```

### Pagination
- Page size selector: 50 / 100 / 250 / 500 / 1000
- "Page 1 of N" with prev/next
- Total count display

### Toggle chips (above table)
- Problem Orders Only
- Open Issues Only
- Critical Only
- Repeated Orders Only
- New Stuck Orders Only
- Unassigned Only
- Likely Stock Issue

### Filter bar (collapsible)
Search (Order ID / SKU / Channel Ref), date range, age, Brand, Channel, Warehouse, Order Status, Severity, Problem Type, Issue Status, Assigned To

### Saved view presets
- All Orders
- Potential Problem Orders
- Critical Orders
- **Needs Action Now** — open + unsuppressed + unresolved + severity Problem or Critical
- Repeated Across Snapshots
- New > 12h / New > 24h
- Open Stock Issues

### Table columns (default)
Order ID | Line | Order Date | Age (Hours) | Order Status | Brand | SKU | Product Name | Qty | Channel | Warehouse | Times Seen | Problem Type | Severity | Issue Status | Assigned To | Last Seen

Severity colours: Watch=amber, Problem=orange, Critical=red.

### Detail panel (row click)
- Order snapshot history
- Status change timeline
- Why flagged (rule explanation)
- Issue controls: assign, add notes, resolve, **suppress** (with reason + optional expiry)

## Files Created/Modified
- **Migration**: extend `order_lines`, create `order_issues`
- `supabase/functions/sync-mintsoft-orders/index.ts` — capture extra fields, status change detection
- `supabase/functions/evaluate-order-issues/index.ts` — new
- `src/pages/SalesOrders.tsx` — rewrite
- `src/components/orders/OrderFilters.tsx` — new
- `src/components/orders/OrderTable.tsx` — new
- `src/components/orders/OrderDetail.tsx` — new
- `src/hooks/useOrderTelemetry.ts` — new

