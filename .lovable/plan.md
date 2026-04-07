

## Problem

The "Has Images" filter returns zero results due to two bugs:

### Bug 1 — `is_primary` mismatch
The query joins `product_images` with `.eq("product_images.is_primary", true)`, but 93 of 101 images have `is_primary = false`. The join returns empty arrays for most products, so no thumbnails appear and the filter finds nothing.

### Bug 2 — Client-side filtering after pagination
The "Has Images" check runs in JavaScript after fetching a page of 100 products from 183,000+. Even if images existed, the filter would only find matches within the current page — it cannot surface products with images from elsewhere in the dataset.

### Secondary issue — no images marked primary
Only 8 images are primary (all pending-path ones). The 93 clean images aren't marked primary, so thumbnails never show in the table even without the filter.

---

## Fix

### 1. Mark all existing images as primary where a product has only one image
Run a migration to set `is_primary = true` for all single-image products. This fixes thumbnails and the join filter.

```sql
UPDATE product_images
SET is_primary = true
WHERE product_id IN (
  SELECT product_id FROM product_images
  GROUP BY product_id HAVING count(*) = 1
);
```

### 2. Move "Has Images" filter server-side
Instead of filtering client-side, use an `INNER JOIN` approach: when `hasImages` is true, add `.not("product_images", "is", "null")` to the query so only products with at least one image row are returned from the database. This ensures pagination works correctly with the filter.

### 3. Remove the `is_primary` constraint from the join (or make it conditional)
Change the join to not filter by `is_primary` for the purpose of detecting whether images exist. For thumbnail display, pick the first image (primary preferred, fallback to any).

### Files Changed

| File | Change |
|------|--------|
| Migration SQL | Set `is_primary = true` for single-image products |
| `src/hooks/useSkuDatabase.ts` | Remove `.eq("product_images.is_primary", true)`, move hasImages filter server-side using `.not("product_images", "is", "null")` |

