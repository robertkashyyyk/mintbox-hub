

# Backfill All Product Images to Clean URL Structure

## Current State
- **50 total** images in `product_images`
- **32** already clean: `FA1-VW445-220/FA1-VW445-220.png`
- **18** dirty: `258d459b-bdf5-4f7f-928c-cd3af184a4f3/1774423483250-FA1-VW472-080.png` (UUID folder + timestamp-prefixed filename)

## Plan

### 1. New edge function: `supabase/functions/backfill-image-paths/index.ts`

Queries `product_images` joined with `products_cache` for all rows where `file_path` does NOT match the clean `{sku}/{sku}.{ext}` pattern. For each dirty image:

1. Look up the product's SKU via `product_id`
2. Derive the clean path: `{sku}/{sku}.{ext}` (or `{sku}/{sku}-2.{ext}` if multiple images per product)
3. **Copy** the file in storage to the new path (copy rather than move, so we have a safe fallback)
4. Update the `product_images` row with the new `file_path` and `public_url`
5. Delete the old storage file after successful update
6. Return a summary: moved count, error count, details

### 2. Add trigger button to `src/pages/discovery/BulkImageUpload.tsx`

A "Clean Up URLs" button below the drop zone that:
- Calls the edge function
- Shows a progress toast with results (e.g. "18 images migrated to clean URLs")
- Disabled while running

### Files
- `supabase/functions/backfill-image-paths/index.ts` — new
- `src/pages/discovery/BulkImageUpload.tsx` — add button

