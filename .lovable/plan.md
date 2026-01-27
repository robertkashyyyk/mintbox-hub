

# Fix Enrichment Timeout & Enhance Progress Display

## Problem Identified
The 30-minute cron job is firing, but the Edge Function times out because processing 500 products sequentially (each with 2 API calls + 100ms delay) takes too long. At ~200ms per product minimum, 500 products = 100+ seconds, exceeding Edge Function limits.

## Solution Overview

### 1. Reduce Batch Size to Prevent Timeouts
Change `BATCH_SIZE` from 500 to **200** in the Edge Function. This keeps each run under the timeout limit while still processing ~9,600 products/day at 30-minute intervals.

### 2. Remove Duplicate Cron Job
Delete the old 2-hour cron job (#23) that's no longer needed, keeping only the 30-minute job (#24).

### 3. Add Progress Bar to Discovery Queue
Enhance the UI to show total catalog progress (how many products have been enriched out of total).

---

## Technical Changes

### File: `supabase/functions/mintsoft-enrich-batch/index.ts`
- Change line 31: `const BATCH_SIZE = 500;` to `const BATCH_SIZE = 200;`

### Database: Remove duplicate cron job
```sql
SELECT cron.unschedule(23);
```

### File: `src/pages/discovery/DiscoveryQueue.tsx`
Add a new stat card showing overall progress:
- **Total Products**: Count from `products_cache`
- **Fully Enriched**: Count where `last_stock_sync IS NOT NULL`
- **Progress Bar**: Visual percentage indicator

---

## Updated UI Layout

```text
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Awaiting        │  │ Enriched Today  │  │ Overall         │  │ Last Run        │
│ Enrichment      │  │                 │  │ Progress        │  │                 │
│ 181,770         │  │ 0               │  │ ████░░░░ 0.7%   │  │ 2 hours ago     │
│                 │  │                 │  │ 1,302/183,072   │  │ ok - 500        │
└─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Expected Outcome
- Enrichment runs successfully every 30 minutes
- ~200 products enriched per run = 9,600/day
- Full catalog enriched in ~19 days (vs previous 8 days at 500/run, but actually working)
- Visual progress tracking in the UI

---

## Files to Modify
1. `supabase/functions/mintsoft-enrich-batch/index.ts` - Reduce BATCH_SIZE to 200
2. `src/pages/discovery/DiscoveryQueue.tsx` - Add overall progress card with progress bar
3. Database operation - Unschedule cron job #23

