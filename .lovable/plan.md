

# Fix Low-Contrast Text Across Dark Mode

## Problem
Labels, placeholders, and muted text (filter labels like "Search", "Brand", badge text, etc.) use `text-muted-foreground` which resolves to `hsl(214, 12%, 60%)` in dark mode. Against the dark charcoal/graphite backgrounds, this is too dim and hard to read — as visible in the screenshot where filter labels nearly disappear.

## Fix — Single CSS variable change in `src/index.css`

In the `.dark` block, bump `--muted-foreground` lightness from `60%` to `72%`:

```css
/* Was: */
--muted-foreground: 214 12% 60%;

/* Now: */
--muted-foreground: 214 12% 72%;
```

This single change fixes all labels, placeholders, helper text, and muted descriptions across every page — SKU Database filters, Buy Recommendation filters, sidebar secondary text, table headers, badges, etc.

## Why 72%
- 60% gives ~3.2:1 contrast against `#0f172a` — below WCAG AA (4.5:1)
- 72% gives ~5.5:1 contrast — passes WCAG AA and is clearly readable without being too bright

## Files Modified
- `src/index.css` — one line change in `.dark` block

