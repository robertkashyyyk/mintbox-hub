

# Two Changes: Fix Order Sync Pagination + SKU Database Enhancements

## 1. Fix Order Sync to Handle 500-600 Orders/Day

The current `sync-mintsoft-orders` edge function has `Limit=100` and no pagination. With 500-600 dispatched orders per day, it only captures the first 100.

**Change**: Add pagination loop to `supabase/functions/sync-mintsoft-orders/index.ts`
- For each status ID, loop through pages (`PageNo=1,2,3...`) with `Limit=100` until an empty page is returned
- This ensures all 500-600+ daily orders are captured
- The daily cron (2-day window) will now pull everything

## 2. SKU Database: Thumbnail + Clickable SKU Link

**Changes to `src/pages/SkuDatabase.tsx`**:
- Add a small thumbnail (24x24px) to the left of each SKU using the `product_images` table (primary image)
- Update the query in `src/hooks/useSkuDatabase.ts` to join `product_images` (where `is_primary = true`) to get the `public_url`
- Make the SKU text a clickable link (`<Link to={/discovery/products/${product.id}}>`) that navigates to the existing ProductDetail page
- Show a placeholder icon (e.g. `ImageIcon`) when no image exists

## 3. Enrich ProductDetail Page

The existing `ProductDetail` page already shows stock, price hunter data, and images. We'll add the remaining fields we hold:

**Changes to `src/pages/ProductDetail.tsx`**:
- Add: Barcode, Barcode Type, Weight, Height, Length, Depth, Handling Time, Low Stock Alert Level, Suppliers, Mintsoft Product ID
- Add: Discovery Source and Discovered At
- Add: Categories (join `product_category_links` + `product_categories`)
- Add: Fire Sale and Discontinued status badges
- Organize into logical card sections (Physical Attributes, Identifiers, etc.)

### Files to modify
- `supabase/functions/sync-mintsoft-orders/index.ts` — add pagination loop
- `src/hooks/useSkuDatabase.ts` — add `product_images` join to query
- `src/pages/SkuDatabase.tsx` — add thumbnail + clickable SKU link
- `src/pages/ProductDetail.tsx` — display all available product fields

