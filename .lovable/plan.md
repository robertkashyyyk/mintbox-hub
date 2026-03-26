

# Bulk Fix — Grey-on-Dark Visibility + Broken Routes + Label Corrections

## Problem Summary
Many sub-pages still use their own `<header>` blocks with grey "Back" buttons, grey titles, and grey action buttons that are invisible on the dark background. Several sidebar links point to wrong/broken routes. "Price Push" should be "Price Hunter".

## Pages to Fix (12 files)

### Group A — Remove custom headers, use simple `text-white` titles + teal back buttons

Each of these pages wraps content in a custom `<header className="border-b bg-card">` with a grey back button and grey title. The fix for each is the same pattern: remove the outer `min-h-screen` + `header` wrapper, replace with a simple `<div className="space-y-6">` containing a white `h1`, `text-white/60` subtitle, and teal-coloured back button.

1. **`src/pages/discovery/BulkImageUpload.tsx`** — Remove header, teal back button, white title
2. **`src/pages/discovery/PendingImages.tsx`** — Same treatment
3. **`src/pages/operations/OpsDashboard.tsx`** — Remove header; white title; teal back button; `outlineDark` variant on Refresh button (or `text-white border-white/20`)
4. **`src/pages/operations/OpsReports.tsx`** — Same; teal back button; white title; fix "Send Test Report" button visibility
5. **`src/pages/operations/OrderMonitoring.tsx`** — White title (currently grey `h1`), `text-white/60` subtitle
6. **`src/pages/admin/SystemSettings.tsx`** — Remove header wrapper; teal back button; white title
7. **`src/pages/admin/Integrations.tsx`** — Remove header; teal back button; white title; fix "Managing Secrets" link button to use `text-pd-accent` styling
8. **`src/pages/ApiAccess.tsx`** — Teal back button (currently grey `variant="ghost"`); title already white — good
9. **`src/pages/PriceHunter.tsx`** — Teal back button; change "Back to Tools" → navigate to `/execution`; title already white

### Group B — Title-only fixes (no header to remove)

10. **`src/pages/Settings.tsx`** — Title already white, no changes needed
11. **`src/pages/UserManagement.tsx`** — Delegates to `UserManagement` component; need to check that component's header

### Group C — Route + sidebar fixes in `src/components/AppSidebar.tsx`

12. **`src/components/AppSidebar.tsx`**:
    - Change `"Buy Recommendations"` URL from `/decisions/buy` to `/decisions/buying`
    - Change `"Price Push"` label to `"Price Hunter"`
    - Change `"Monitoring"` URL from `/operations/order-monitoring` to `/operations/monitoring`

13. **`src/App.tsx`**:
    - Add route: `/decisions/buying` → `BuyRecommendations`
    - Add redirect: `/decisions/buy` → `/decisions/buying`
    - Add route: `/operations/monitoring` → `OrderMonitoring`
    - Keep old `/operations/order-monitoring` as redirect to `/operations/monitoring`

### Consistent pattern for back buttons
```tsx
<Button variant="ghost" size="sm" className="text-pd-accent hover:text-pd-accent-light" onClick={() => navigate("/parent")}>
  <ArrowLeft className="h-4 w-4 mr-2" />
  Back to Parent
</Button>
```

### Consistent pattern for page headers
```tsx
<div>
  <h1 className="text-2xl font-bold text-white">Page Title</h1>
  <p className="text-white/60">Subtitle text</p>
</div>
```

## Files Modified
- `src/components/AppSidebar.tsx` — route URLs + label fix
- `src/App.tsx` — new routes + redirects
- `src/pages/discovery/BulkImageUpload.tsx` — header cleanup
- `src/pages/discovery/PendingImages.tsx` — header cleanup
- `src/pages/operations/OpsDashboard.tsx` — header cleanup + button visibility
- `src/pages/operations/OpsReports.tsx` — header cleanup + button visibility
- `src/pages/operations/OrderMonitoring.tsx` — title colour
- `src/pages/admin/SystemSettings.tsx` — header cleanup
- `src/pages/admin/Integrations.tsx` — header cleanup + button visibility
- `src/pages/ApiAccess.tsx` — back button teal
- `src/pages/PriceHunter.tsx` — back button teal + nav target fix

