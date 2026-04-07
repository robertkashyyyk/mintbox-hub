

## Issues Found

### 1. RLS Error — Missing Storage UPDATE Policy

The `product-images` bucket has INSERT, SELECT, and DELETE policies but **no UPDATE policy**. The upload code uses `upsert: true`, which requires UPDATE permission. This is the direct cause of the error.

**Fix**: Add an UPDATE policy on `storage.objects` for the `product-images` bucket for authenticated users.

```sql
CREATE POLICY "Authenticated users can update product images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'product-images')
WITH CHECK (bucket_id = 'product-images');
```

### 2. Simplified, Predictable Image URLs

Currently images are stored as `{sku}/{sku}.{ext}`, producing URLs like:
```
https://.../storage/v1/object/public/product-images/FA1-KF100015/FA1-KF100015.png
```

To make URLs maximally predictable ("just add the SKU"), we can flatten to `{sku}.webp` (or keep original extension). The URL becomes:
```
https://.../storage/v1/object/public/product-images/FA1-KF100015.png
```

You'd always know the URL if you know the SKU + extension. However, extensions can vary (png, jpg, webp).

**Recommendation**: Keep the current `{sku}/{sku}.{ext}` structure (subfolder allows multiple images per SKU), but add a helper constant so you never have to think about it:

```typescript
const imageUrl = (sku: string, ext = 'png') =>
  `${SUPABASE_URL}/storage/v1/object/public/product-images/${sku}/${sku}.${ext}`;
```

This gets exposed as a reusable utility across the app.

### Files Changed

| File | Change |
|------|--------|
| Migration SQL | Add UPDATE policy on `storage.objects` |
| `src/lib/imageUrl.ts` | New helper: `getProductImageUrl(sku, ext?)` |
| `BulkImageUpload.tsx` | Use helper for URL generation |
| `ProductImageUpload.tsx` | Use helper for URL generation |

