

## Flatten Image URL Structure

Currently images are stored as `{sku}/{sku}.{ext}` (in a subfolder). You want them flat at the bucket root: `{sku}.{ext}`, producing URLs like:

```
.../product-images/FA1-438-282.png
```

instead of:

```
.../product-images/FA1-438-282/FA1-438-282.png
```

### Files to Change

| File | Change |
|------|--------|
| `src/lib/imageUrl.ts` | Change path from `{sku}/{sku}.{ext}` to `{sku}.{ext}` |
| `src/components/discovery/ProductImageUpload.tsx` | Upload to `{sku}.{ext}` instead of `{sku}/{filename}` |
| `src/pages/discovery/PendingImages.tsx` | Promote pending images to `{sku}.{ext}` instead of `{sku}/{sku}.{ext}` |
| `supabase/functions/backfill-image-paths/index.ts` | Update clean pattern regex and target path to flat `{sku}.{ext}`. This will migrate all existing `{sku}/{sku}.{ext}` files to `{sku}.{ext}` when run |

### Detail

**1. `imageUrl.ts`** — Single-line changes:
- `getProductImageUrl` → `...product-images/${sku}.${ext}`
- `getProductImagePath` → `${sku}.${ext}`

**2. `ProductImageUpload.tsx`** — Change `filePath` from `${productSku}/${fileName}` to just `${fileName}` (where fileName is `{sku}.{ext}` or `{sku}-2.{ext}` for additional images)

**3. `PendingImages.tsx`** — Change promoted path from `${sku}/${sku}.${ext}` to `${sku}.${ext}`

**4. `backfill-image-paths` edge function** — Update the "clean" regex to match flat `{sku}.{ext}` pattern, and change the target path from `${sku}/${sku}.${ext}` to `${sku}.${ext}`. Running this after deployment will move all existing subfolder images to flat paths.

**5. After deployment** — User clicks "Clean Up Image URLs" on Bulk Image Upload page to migrate all existing images from subfolder to flat structure.

