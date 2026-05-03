## Why orders 132292+ haven't arrived

The 15-minute cron is running fine — but inside each run, the work is ordered like this today:

```
[terminal sweep: DESPATCHED, CANCELLED, etc. — last 10 days]  ← runs FIRST
       ↓ (eats most/all of the 50s budget)
[hot:  NEW, AWAITINGPICKING, ONBACKORDER, ...]                ← rarely reached
[cold: everything else, round-robin]                          ← never reached
```

The terminal sweep alone has to walk ~30–40k orders (10 days × ~3–4k/day, 100 per page, 50-page cap per status, multiple terminal statuses). It usually consumes the entire 50s budget. Result: `highest_order_id_seen=131710` (the newest DESPATCHED) recurs every run, and `NEW` orders 132280–132291 only got in because one lucky run (09:45) made it past the sweep before timing out.

## Fix — three small, surgical changes to `sync-mintsoft-orders`

### 1. Reverse the priority order
Hot statuses go FIRST, terminal sweep LAST.

```text
[hot: NEW, AWAITINGPICKING, ONBACKORDER, ...]  ← ~5–10s, always finishes
[cold: round-robin, advance cursor]            ← whatever fits
[terminal sweep: DESPATCHED last 10 days]      ← uses leftover budget
```

Hot statuses are small (a few hundred orders total at any moment) so they finish in seconds. Today's order will be in the system within 15 min, guaranteed.

### 2. Cap the terminal sweep
Lower the per-status page cap for terminal statuses from 50 → **10** pages (1,000 orders per terminal status per run). Combined with the 10-day floor, that's plenty to catch status changes from NEW→DESPATCHED on recent orders without eating the budget. The dedicated `reconcile-order-ghosts` cron (separate function, runs every 15 min on its own schedule) handles deeper reconciliation.

### 3. Add a hard "freshness floor" to the run log
Log `oldest_new_order_id_processed` and `oldest_status_in_run` so a glance at `edge_function_runs` immediately tells us "did this run reach NEW?" — no more guessing why `highest_order_id_seen` keeps repeating.

## Files changed
- `supabase/functions/sync-mintsoft-orders/index.ts` — reorder `statusIdsToFetch`, cap terminal page count, expand log details

## What you'll see after deploy
- Next 15-min run: 132292+ should appear (NEW status fetched first)
- `highest_order_id_seen` in the run log should track today's max order ID, not 131710
- Terminal sweep still runs, just with a smaller bite per cycle — plus the separate ghost-reconciler is unaffected

No schema or cron-schedule changes. Pure logic re-ordering inside the edge function.