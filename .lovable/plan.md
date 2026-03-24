

# Product Image Storage

## Overview
Add image upload and management for products in the Discovery section. Each uploaded image gets a public URL that can be used for eBay listings, website, or any other channel.

## What We'll Build

### 1. Storage Bucket: `product-images`
A public storage bucket for product images. Files stored as `{product_id}/{filename}` so each product's images are grouped.

### 2. Database Table: `product_images`
Tracks which images belong to which product, with display order and metadata.

```text
┌──────────────────────────────────────┐
│ product_images                       │
├──────────────────────────────────────┤
│ id (uuid, PK)                        │
│ product_id (uuid, FK → products_cache)│
│ file_path (text) - path in bucket    │
│ public_url (text) - full public URL  │
│ display_order (int, default 0)       │
│ is_primary (boolean, default false)  │
│ created_at (timestamptz)             │
└──────────────────────────────────────┘
```

### 3. Image Upload UI on Product Detail Page
- Drag-and-drop or click-to-upload area
- Image gallery showing all uploaded images
- Set primary image, reorder, delete
- Copy URL button for each image (for use in listings)
- Shows public URL prominently so it can be used elsewhere

### 4. Image Thumbnails in Discovery Queue
Show a small thumbnail in the product list for products that have images.

---

## Technical Details

### Database Migration
- Create `product_images` table with RLS (authenticated users can CRUD)
- Create `product-images` storage bucket (public, so URLs work without auth)
- Storage RLS: authenticated users can upload/delete; public can read

### Files to Create/Modify
1. **New**: `src/components/discovery/ProductImageUpload.tsx` - Upload component with drag-and-drop, gallery, copy URL
2. **Modify**: `src/pages/ProductDetail.tsx` - Add image section
3. **Modify**: `src/pages/discovery/DiscoveryQueue.tsx` - Optional: show thumbnail column

### URL Format
Each image gets a permanent public URL like:
```
https://{project}.supabase.co/storage/v1/object/public/product-images/{product_id}/image1.jpg
```
This URL can be copied and used directly in eBay listings, websites, etc.

### Security
- Anyone can view images (public bucket for listing use)
- Only authenticated users can upload/delete
- RLS on `product_images` table for authenticated users

