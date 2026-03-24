

# Bulk Image Upload for Discovery

## Overview
Add a new "Bulk Image Upload" page to the Discovery menu where you can upload images in bulk, matched to products by SKU. This lets you upload a batch of image files named by SKU (e.g., `ABC123.jpg`) and automatically link them to the correct products in `product_images`.

## How It Works

1. **New menu item** in Discovery Index: "Bulk Image Upload" card
2. **New page** at `/discovery/bulk-images` with:
   - Drag-and-drop zone accepting multiple image files
   - Files are matched to products by filename → SKU lookup (e.g., `ABC-123.jpg` matches SKU `ABC-123`)
   - Preview grid showing each file, its matched SKU, and status (matched/unmatched)
   - "Upload All" button to process matched images
3. **Upload process**: For each matched file, upload to `product-images` storage bucket under `{product_id}/` and insert into `product_images` table — reusing the same storage and table already set up
4. **Results summary**: Shows how many uploaded successfully, how many SKUs weren't found

## Technical Changes

### New Files
- `src/pages/discovery/BulkImageUpload.tsx` — Main page with drag-and-drop, SKU matching preview, batch upload logic

### Modified Files
- `src/pages/DiscoveryIndex.tsx` — Add "Bulk Image Upload" card to the menu grid
- `src/App.tsx` — Add route `/discovery/bulk-images`

### SKU Matching Logic
1. User drops files (e.g., `SKU-001.jpg`, `SKU-002.png`)
2. Extract SKU from filename (strip extension)
3. Query `products_cache` to find matching products by SKU
4. Show preview: green = matched, red = no match found
5. On confirm, upload each matched image to storage and insert `product_images` record

### No database changes needed
The existing `product_images` table and `product-images` storage bucket are already in place with correct RLS policies.

