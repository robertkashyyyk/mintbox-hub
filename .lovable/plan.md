

# Fix Mintsoft Product PULL — No Results for FA1-

## Root Cause

Two issues:

1. **Wrong search strategy**: `SearchTerm=FA1-` does a general text search across all Mintsoft product fields (name, barcode, description), not a SKU-prefix filter. The API returns hundreds of irrelevant products, and the client-side `skuMatchesPrefix` filter rejects them all — giving 0 results even though FA1- products exist.

2. **Crash bug on line 147**: `maxPages` (camelCase) is used but the variable is `MAX_PAGES` (UPPER_SNAKE). This causes a `ReferenceError` after the pagination loop exits, killing the function before it can return.

## Fix

### `supabase/functions/mintsoft-fetch-products/index.ts`

1. **Fix the typo**: Line 147 — change `maxPages` to `MAX_PAGES`.

2. **Use SKU-specific search**: Change the API URL to filter by SKU directly using Mintsoft's SKU filter parameter. The Mintsoft API supports `SKU` as a query parameter on `/api/Product/List`. Instead of:
   ```
   /api/Product/List?SearchTerm=FA1-&PageNo=1&Limit=100
   ```
   Use:
   ```
   /api/Product/List?SKU=FA1-&PageNo=1&Limit=100
   ```
   This tells Mintsoft to filter on the SKU field specifically, returning only products whose SKU contains "FA1-".

3. **Fallback**: If the `SKU` parameter returns an error (some Mintsoft versions may not support it), fall back to `SearchTerm` but log a warning. This makes the function resilient.

4. **Preview mode optimisation**: For preview, scan up to 10 pages (1,000 products) before giving up, rather than continuing indefinitely. Add a `maxPreviewPages` cap of 10 with a clear message if no matches found.

## Files Modified
- `supabase/functions/mintsoft-fetch-products/index.ts` — fix typo, use SKU parameter, add fallback

