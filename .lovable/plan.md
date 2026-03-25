

# Fix Mintsoft Product PULL — SKU Parameter Not Filtering

## Problem
The logs confirm: `SKU=FA1-` returns 100 products per page, but **none** start with "FA1-". The Mintsoft `/api/Product/List` endpoint ignores the `SKU` and `SearchTerm` parameters for prefix matching — it just returns all products in arbitrary order. After 10 pages (1,000 products), the function gives up with 0 matches.

## Root Cause
The Mintsoft API does not support server-side SKU prefix filtering. Neither `SKU=` nor `SearchTerm=` does what we need. This is confirmed by:
- 10 pages × 100 results = 1,000 products returned, 0 matching "FA1-"
- The `poll-inventory` code even has a comment: *"API doesn't support prefix filtering, so we fetch all and filter"*

## Solution
**Change strategy: drop the API query params entirely, paginate through the full product list, and filter client-side.** The tradeoff is more pages to scan, but Mintsoft products are paginated at 100/page and the function already handles pagination.

### Changes to `supabase/functions/mintsoft-fetch-products/index.ts`

1. **Remove the `SKU`/`SearchTerm` param logic** — just use `/api/Product/List?PageNo={n}&Limit=100` with no filter parameter since Mintsoft ignores them anyway.

2. **Remove the `useSku`/fallback complexity** — simplify `fetchProductPage` to a single, clean fetch with no retry logic.

3. **Add debug logging** — log the first 3 SKUs from page 1 so we can verify what's being returned.

4. **Increase preview page limit** — change `MAX_PREVIEW_PAGES` from 10 to 50 (5,000 products) since we're scanning linearly. With ~200k products this still won't find everything, but FA1- products should appear within a reasonable window if they exist.

5. **Add early termination for preview** — once we find 5+ matching products, stop scanning immediately.

6. **For import mode**, increase `MAX_PAGES` cap to 2500 (250k products) to cover the full catalog, but add a timeout-aware approach: if we've found some matches and haven't found new ones in 20 consecutive pages, stop (the products are likely grouped by creation order).

### Technical detail

```text
Before:  /api/Product/List?SKU=FA1-&PageNo=1&Limit=100  → returns random products
After:   /api/Product/List?PageNo=1&Limit=100            → same products, but we accept it

Client-side filter remains:  sku.startsWith("FA1-") || sku.startsWith("FA1")
```

The key insight is that the API never filtered — we were just looking at the wrong 1,000 out of 200,000+ products.

## Files Modified
- `supabase/functions/mintsoft-fetch-products/index.ts`

