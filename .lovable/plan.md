

# Clean Up Image Storage URLs

## Current State
Images are stored with paths like:
- Direct upload: `{product-uuid}/{timestamp}-{index}.png`
- Bulk upload (matched): `{product-uuid}/{timestamp}-{sku}.png`
- Bulk upload (unmatched): `pending/{timestamp}-{sku}.png`

This produces long, ugly URLs with UUIDs and timestamps.

## Proposed Clean Structure

**Matched/direct images**: `{sku}/{sku}.{ext}` (single image) or `{sku}/{sku}-{index}.{ext}` (multiple)
- Example: `product-images/FA1-KF100015/FA1-KF100015.png`
- Second image: `product-images/FA1-KF100015/FA1-KF100015-2.png`

**Pending/unmatched images**: `pending/{sku}.{ext}` (no timestamp)
- Example: `product-images/pending/FA1-KF100015.png`

The timestamp prefix currently prevents filename collisions but makes URLs ugly. Since SKUs are unique and we track display_order, we can use a simple index suffix instead.

## Changes

### 1. `src/components/discovery/ProductImageUpload.tsx`
Update `handleUpload` to build path as `{sku}/{sku}-{index}.{ext}` where index is `currentCount + i`, or just `{sku}/{sku}.{ext}` for the first image. Use `upsert: true` to handle re-uploads cleanly.

### 2. `src/pages/discovery/BulkImageUpload.tsx`
- **Matched path**: change from `${productId}/${Date.now()}-${sku}.${ext}` to `${sku}/${sku}.${ext}`
- **Pending path**: change from `pending/${Date.now()}-${sku}.${ext}` to `pending/${sku}.${ext}`

### 3. `src/pages/discovery/PendingImages.tsx`
When promoting a pending image, move it from `pending/{sku}.{ext}` to `{sku}/{sku}.{ext}` using storage `move()`, and update the `public_url` in the database accordingly.

## Important Notes
- Existing images in the database keep their current URLs (they still work, just ugly)
- Only new uploads get clean URLs going forward
- The `pending/` folder is still needed for unmatched bulk uploads, but without the timestamp noise
- Long-term custom domain (`partsdoc.co.uk/images/...`) would be a CDN/proxy layer on top of this same structure

## Files Modified
- `src/components/discovery/ProductImageUpload.tsx`
- `src/pages/discovery/BulkImageUpload.tsx`
- `src/pages/discovery/PendingImages.tsx`

