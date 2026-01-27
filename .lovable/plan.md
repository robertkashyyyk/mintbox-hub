
# Speed Up Enrichment + Fix Brand Assignment

## Overview
The current enrichment job runs every 2 hours and processes only 50 products per run. With 183,000 products to enrich, this would take ~10 months. We'll increase throughput dramatically and also fix the missing `brand_id` assignment.

## Current State
- **Enrichment rate**: 50 products every 2 hours = 600/day
- **Products needing enrichment**: ~183,000
- **Time to complete**: ~305 days (too slow)
- **Missing brand_id**: 182,049 products have no brand assignment

## What Gets Enriched
The job already fetches comprehensive data from Mintsoft:
- Product name, cost price
- Dimensions (weight, height, length, depth)
- Barcode (EAN/UPC)
- Stock levels (current, on order, backorder)
- Low stock alert level, handling time
- Discontinued status

**Gap identified**: The job doesn't assign `brand_id` based on SKU prefix.

## Proposed Changes

### 1. Increase Batch Size and Frequency
| Setting | Current | Proposed |
|---------|---------|----------|
| Batch size | 50 | 500 |
| Interval | Every 2 hours | Every 30 minutes |
| Products/day | 600 | 24,000 |
| Time to complete | 305 days | ~8 days |

### 2. Add Brand Resolution to Enrichment
When processing each product, lookup the brand based on SKU prefix and set `brand_id`. This ensures all products get properly categorized for reporting and filtering.

### 3. Backfill Existing Products
Run a one-time SQL update to assign `brand_id` to the 182,049 products already imported but missing brand assignment.

---

## Technical Details

### Edge Function Changes
**File**: `supabase/functions/mintsoft-enrich-batch/index.ts`

```typescript
// Increase batch size
const BATCH_SIZE = 500; // Changed from 50

// Add brand resolution
// Fetch brands once at start of batch
const { data: brands } = await supabase
  .from("brands")
  .select("id, prefix, prefix_style")
  .not("prefix", "is", null);

// For each product, match SKU to brand prefix
function resolveBrandId(sku: string, brands: Brand[]): string | null {
  for (const brand of brands) {
    const separator = brand.prefix_style === 'slash' ? '/' : '-';
    if (sku.startsWith(`${brand.prefix}${separator}`)) {
      return brand.id;
    }
  }
  return null;
}

// Include brand_id in the update
.update({
  ...existingFields,
  brand_id: resolveBrandId(product.sku, brands),
})
```

### Cron Schedule Update
Change from `0 */2 * * *` (every 2 hours) to `*/30 * * * *` (every 30 minutes)

### Backfill SQL
One-time update to fix existing products:
```sql
UPDATE products_cache pc
SET brand_id = b.id
FROM brands b
WHERE pc.brand_id IS NULL
  AND b.prefix IS NOT NULL
  AND (
    (b.prefix_style = 'hyphen' AND pc.sku LIKE b.prefix || '-%')
    OR (b.prefix_style = 'slash' AND pc.sku LIKE b.prefix || '/%')
  );
```

---

## Outcome
- All 183,000 products enriched within ~8 days
- Every product gets assigned a `brand_id` for proper categorization
- Ongoing maintenance: 24,000 products refreshed daily (covers full catalog weekly)
