

# Fix: Schedule Daily Order Sync for Velocity Data

## Problem
The Velocity & Coverage page has no meaningful data because `sync-mintsoft-orders` has never been scheduled. It ran once manually on 25 Nov 2025 (82 lines) and never again. The `sku_velocity` materialized view needs continuous order line data to calculate 30/60/90-day sales windows.

## Product Enrichment Status (Good News)
Enrichment is essentially complete: 182,971 products enriched, 88% have cost prices, 0 remaining in the enrichment queue. No action needed here.

## Changes

### 1. Schedule `sync-mintsoft-orders` as a daily cron job
- Run daily at **06:00 UTC** (before the AM order snapshot at 07:30)
- Pass `fromDate` as 2 days ago to catch any stragglers
- Uses the existing edge function with no code changes needed
- SQL insert into `cron.schedule` (same pattern as existing jobs)

### 2. Backfill: Run a one-time historical pull
- Invoke `sync-mintsoft-orders` manually with `fromDate` set to 90 days ago
- This populates the 30/60/90-day velocity windows immediately
- Without this, it would take 90 days of daily syncs to fill the view

### 3. Schedule `sku_velocity` materialized view refresh
- The materialized view needs periodic refresh to reflect new order data
- Add a daily cron job to run `REFRESH MATERIALIZED VIEW sku_velocity` after the order sync completes (e.g. 06:30 UTC)

### 4. Add `sync-mintsoft-orders` to `supabase/config.toml`
- Add `verify_jwt = false` entry so the cron job can call it without auth

## Technical Detail

The cron schedule will be:
- `0 6 * * *` — sync orders daily at 06:00 UTC
- `30 6 * * *` — refresh `sku_velocity` materialized view

The backfill call will use `fromDate: "2025-12-24"` (90 days back from today) to seed historical data.

