

# Fix Invisible Elements on Product Detail Page

## Problem
On the product detail page, the "← Back" button and the SKU label (e.g. `FA1-KF100015`) use the default grey foreground colour, making them nearly invisible against the dark background.

## Changes

### `src/pages/ProductDetail.tsx`

1. **Back button** (line 225): Add teal text class
   ```tsx
   <Button variant="ghost" size="sm" className="text-pd-accent hover:text-pd-accent-light" onClick={() => navigate(-1)}>
   ```

2. **SKU label** (line 234): Change from default to teal
   ```tsx
   <div className="font-mono text-lg text-pd-accent">{product.sku}</div>
   ```

3. **DetailRow labels** (line 217): These `text-muted-foreground` labels inside cards should already be fine since card foreground is near-white, but worth checking. No change unless needed.

Two quick class additions, same file.

