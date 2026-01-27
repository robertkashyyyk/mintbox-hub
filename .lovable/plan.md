

# Mintsoft Catalog Import with Background Enrichment

## Overview

Upload a minimal CSV (ProductID, SKU, Name) to seed the catalog. A scheduled background job then enriches products in small batches every 1-2 hours, avoiding API timeouts.

## Architecture

```text
+------------------+                    +-------------------+
|  Mintsoft CSV    |    One-time       |   products_cache  |
| (ID, SKU, Name)  | --> Upload -->    | (200k+ products)  |
+------------------+                    +-------------------+
                                               |
                                               | Every 1-2 hours
                                               v
                                    +------------------------+
                                    | mintsoft-enrich-batch  |
                                    | (50-100 products/run)  |
                                    +------------------------+
                                               |
                                               | Fetch: stock, cost,
                                               | barcode, etc.
                                               v
                                    +------------------------+
                                    |  Mintsoft API          |
                                    |  /Product/{id}/Details |
                                    +------------------------+
```

## What Changes

### 1. Update CSV Processor for Minimal Format

**File:** `supabase/functions/process-product-csv/index.ts`

Add flexible column detection to support:

| Mintsoft Export Column | Possible Names | Maps To |
|------------------------|----------------|---------|
| Product ID | `ProductID`, `ID`, `ProductId`, `MintsoftProductID` | `mintsoft_product_id` |
| SKU | `SKU`, `Sku` | `sku` |
| Name | `Name`, `ProductName`, `Title` | `name` |

When minimal CSV detected (only these 3 columns):
- Skip barcode, category, stock processing
- Set `discovery_source = 'catalog_import'`
- Set `discovered_at = now()`
- Much faster import (no category lookups)

### 2. Update Enrichment View

**Database Migration**

Modify `products_needs_enrichment` view to include catalog imports:

```sql
-- Products needing enrichment: from orders OR catalog imports missing data
CREATE OR REPLACE VIEW products_needs_enrichment AS
SELECT * FROM products_cache
WHERE 
  -- Original: order-discovered products missing cost/stock
  (discovery_source = 'order' AND (cost_price IS NULL OR current_stock IS NULL))
  OR
  -- New: catalog imports that haven't been enriched yet
  (discovery_source = 'catalog_import' AND last_stock_sync IS NULL);
```

### 3. Create Background Enrichment Job

**New File:** `supabase/functions/mintsoft-enrich-batch/index.ts`

This function:
1. Finds 50 products with `mintsoft_product_id` that need enrichment
2. Calls Mintsoft API `/api/Product/{id}` for each to get full details
3. Updates `products_cache` with: cost_price, stock levels, barcode, weight, etc.
4. Sets `last_stock_sync = now()` to mark as enriched
5. Logs progress to `ingest_run_state`

Prioritization logic:
```text
1. Products with mintsoft_product_id but last_stock_sync IS NULL (never enriched)
2. Products with last_stock_sync > 7 days (stale data)
3. Limit to 50 per run to avoid timeouts
```

### 4. Schedule the Enrichment Job

**Cron Job** (every 2 hours):
```sql
SELECT cron.schedule(
  'mintsoft-enrich-batch',
  '0 */2 * * *',  -- Every 2 hours
  $$
  SELECT net.http_post(
    url := 'https://zadsuqxcchpnegcynflb.supabase.co/functions/v1/mintsoft-enrich-batch',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ..."}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

At 50 products per run, 12 runs per day = 600 products enriched daily. Full catalog (200k) enriched in ~11 months for first pass, but priority is products that are actually being sold/used.

### 5. UI Updates

**File:** `src/components/importing/ProductCacheUpload.tsx`

Add guidance for minimal CSV format:
- "For quick catalog import, include just: ProductID, SKU, Name"
- "Full details will be fetched automatically in the background"

**File:** `src/pages/discovery/DiscoveryQueue.tsx`

Add enrichment progress indicator:
- Count of products awaiting enrichment
- Last enrichment run time
- "X products enriched today"

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `supabase/functions/process-product-csv/index.ts` | MODIFY | Add flexible column mapping, detect minimal format |
| `supabase/functions/mintsoft-enrich-batch/index.ts` | CREATE | Background job to enrich products from Mintsoft API |
| Database migration | CREATE | Update `products_needs_enrichment` view |
| Database (SQL insert) | CREATE | Add cron job for enrichment |
| `src/components/importing/ProductCacheUpload.tsx` | MODIFY | Add minimal format guidance |
| `src/pages/discovery/DiscoveryQueue.tsx` | MODIFY | Add enrichment progress stats |

---

## Benefits

1. **Fast initial import**: 200k products in minutes (minimal data, no API calls)
2. **No timeouts**: Enrichment happens in small batches over time
3. **Priority-based**: Most-used products can be enriched first
4. **Leverages existing infrastructure**: Uses your Discovery Queue workflow
5. **Incremental**: Run enrichment as often or as little as needed

---

## Expected Workflow

```text
Day 1:
1. Export products from Mintsoft (ID, SKU, Name columns)
2. Upload CSV to Product Cache Upload
3. ~200k products imported in a few minutes

Day 1-onward:
- Every 2 hours: 50 products enriched with full details
- Discovery Queue shows products needing enrichment
- High-priority products (from orders) enriched first
- After 2-3 weeks: most active products fully enriched
```

