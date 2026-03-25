

# Fix Unreadable UI Elements — Apply Teal Accent to Key Interactive Elements

## Problem
The sidebar toggle button (expand/collapse) and page titles like "SKU Database" are barely visible against the dark background. The inherited `foreground` color isn't punchy enough for these navigational elements.

## Approach
Use the teal accent (`#279e8a` / `--pd-accent`) for key interactive and heading elements that need to stand out, rather than relying on the generic foreground color.

## Changes

### 1. SidebarTrigger — `src/pages/DashboardLayout.tsx`
Pass an explicit teal text class to the `SidebarTrigger`:
```tsx
<SidebarTrigger className="text-[hsl(var(--pd-accent))] hover:text-[hsl(var(--pd-accent-light))]" />
```

### 2. Page title "SKU Database" — `src/pages/SkuDatabase.tsx`
Change the `<h1>` from default foreground to white for maximum readability:
```tsx
<h1 className="text-3xl font-bold text-white">SKU Database</h1>
```
And the subtitle count text to a lighter muted:
```tsx
<p className="text-white/60 mt-2">
```

### 3. All other page-level `<h1>` headings across module pages
Apply the same `text-white` treatment to top-level headings in all module index/detail pages that sit on the dark background. This affects pages like:
- `BuyRecommendations.tsx`, `StockHealth.tsx`, `VelocityCoverage.tsx`, `PriceHunter.tsx`, `SalesOrders.tsx`, `Importing.tsx`, `Settings.tsx`, `Profile.tsx`, `UserManagement.tsx`, and other pages that have a standalone `<h1>` outside a `ModuleHeader`.

### 4. Card titles inside dark cards — review `CardTitle` defaults
Since `--card-foreground` is already `210 20% 95%` (near-white), card titles should already be fine. No change needed.

## Summary
- **SidebarTrigger**: Teal icon color
- **Page `<h1>` titles**: Explicit `text-white`
- **Subtitles/counts**: `text-white/60` instead of `text-muted-foreground`

Two files changed minimum (`DashboardLayout.tsx`, `SkuDatabase.tsx`), plus a sweep of other page files for consistency.

