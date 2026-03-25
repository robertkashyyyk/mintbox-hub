

# Fix SKU Database Filters — Styling, Brand Bug, and "Has Images" Filter

## Issues

1. **Filter labels invisible** — Labels like "Search", "Brand", "to" use `text-muted-foreground` which is too dim on the card background. Input text inside dark select/input boxes is also hard to read.
2. **Brand filter returns nothing** — Brand filtering happens client-side after pagination (SKU prefix matching on only 100 rows). Since `products_cache` has a `brand_id` column, this should be a server-side `.eq("brand_id", ...)` filter.
3. **Missing "Has Images" filter** — New checkbox filter to show only products that have at least one image.

## Changes

### 1. `src/components/sku-database/SkuFilters.tsx` — Styling and new filter

- Change filter icon and labels from `text-muted-foreground` to `text-pd-accent` (teal)
- Change range separator "to" spans from `text-muted-foreground` to `text-white/70`
- Add input class overrides: `text-white placeholder:text-white/40` on all `<Input>` and `<SelectTrigger>` elements
- Add `hasImages: boolean` to `FilterState` interface
- Add a `<Checkbox>` + label for "Has Images" filter in the grid
- Include `hasImages` in `activeFilterCount` and `clearAllFilters`

### 2. `src/hooks/useSkuDatabase.ts` — Fix brand filter + add has-images filter

- **Brand filter (server-side)**: Instead of client-side SKU prefix matching, look up the selected brand name in the `brands` array to get its `id`, then apply `.eq("brand_id", brandId)` directly in the query. Remove the client-side `filteredData.filter(...)` block.
- **Has Images filter (server-side)**: When `filters.hasImages` is true, use a subquery approach — add an inner join condition by selecting products that have matching `product_images` records. Since we already select `product_images`, we can filter client-side for this one (checking `product_images.length > 0`) or use `.not("product_images", "is", null)`.
- Update default `FilterState` to include `hasImages: false`.

### 3. `src/hooks/useSkuDatabase.ts` — Clean up client-side brand sort

Keep the client-side brand sort (when sorting by brand column) since that still needs the prefix lookup for display, but remove the client-side brand *filter* entirely since it now happens server-side.

## Files Modified
- `src/components/sku-database/SkuFilters.tsx` — styling + checkbox
- `src/hooks/useSkuDatabase.ts` — server-side brand filter, has-images filter

