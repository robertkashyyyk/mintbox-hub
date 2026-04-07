

## Problem

The SKU Database table has 15 columns. When the sidebar is open, the content area is constrained by `container mx-auto` (max-width ~1280px), but the table overflows that width. The white gaps on the right appear because:

1. The `<main>` uses `container mx-auto` which caps content width, but the table naturally exceeds it
2. The table wrapper `div.rounded-md.border` lacks `overflow-x-auto`, so horizontal scroll doesn't contain properly within the card
3. The Card itself doesn't fill the available width on wider viewports when the table overflows

## Fix

Two changes:

### 1. DashboardLayout — remove container constraint for full-width pages
Change `<main className="flex-1 container mx-auto px-4 py-8">` to `<main className="flex-1 px-4 py-8 max-w-full overflow-hidden">` so the content fills the available space rather than being capped at the container breakpoint.

### 2. SkuDatabase — add horizontal scroll to table wrapper
Wrap the table's `div.rounded-md.border` with `overflow-x-auto` so the table scrolls cleanly within the card boundary instead of bleeding into white space.

```
<div className="rounded-md border overflow-x-auto">
```

These two changes ensure the page background extends fully and the table scrolls horizontally within its card container without exposing white gutters.

