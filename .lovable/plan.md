

# Fix: Product PULL Not Finding Products

## The Problem
The current `mintsoft-fetch-products` edge function uses `/api/Product/List` which returns ALL products paginated. In preview mode it only scans 10 pages (1,000 products). With 200K+ products in Mintsoft, FA1 products are simply not in the first 1,000 results.

## The Fix
Mintsoft has a dedicated **`GET /api/Product/Search`** endpoint ("Product Search by SKU/Name") that allows server-side filtering. We need to switch the edge function to use this endpoint instead of paging through the entire catalog.

## Technical Changes

### 1. Update `supabase/functions/mintsoft-fetch-products/index.ts`
- Replace `/api/Product/List` with `/api/Product/Search?SearchTerm={prefix}` for the initial query
- This returns only products matching the prefix, eliminating the need to scan thousands of pages
- Keep pagination for the search results in case there are many matches
- For import mode, use the search results directly instead of scanning 500+ pages

### 2. Fallback logic
- If the Search endpoint doesn't support prefix matching well, we can combine it with client-side filtering to ensure only exact prefix matches are kept
- Remove the artificial page caps (MAX_PAGES_PREVIEW = 10) since the search endpoint returns relevant results immediately

## Why This Matters
- **Before**: Scans 1,000 products (10 pages), misses anything not in that range
- **After**: Server-side search returns matching products directly, works regardless of catalog size

