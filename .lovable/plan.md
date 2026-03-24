

# Visual Hub Index Pages & Layout Cleanup

## Summary
Replace the plain text headers on all module index pages with image-driven visual banners (matching the public site's Carbon & Teal aesthetic). Remove redundant navigation elements since the sidebar now handles all navigation.

## Changes

### 1. Create a reusable `ModuleHeader` component
**New file**: `src/components/ModuleHeader.tsx`
- Full-width banner with a background image, dark gradient overlay, module icon, title, and description
- Teal accent bar on the left edge
- Styled consistently with the public site hero treatment (gradient overlay, white text)
- Accepts props: `title`, `description`, `iconName`, `backgroundImage` (optional — falls back to a default gradient)
- No "Back to Main Menu" button (sidebar handles this)

### 2. Remove Sign Out from top header bar
**File**: `src/pages/DashboardLayout.tsx`
- Remove the Sign Out button from the top-right (line 89-92) — already in the sidebar footer
- Keep NotificationBell and "PartsDoc Hub" branding

### 3. Update all module index pages
**Files**: `DiscoveryIndex.tsx`, `IntelligenceIndex.tsx`, `DecisionsIndex.tsx`, `ExecutionIndex.tsx`, `OperationsIndex.tsx`, `AdminIndex.tsx`, `DashboardsIndex.tsx`
- Replace the `<header>` block (containing "Back to Main Menu" button + plain h1/p) with the new `<ModuleHeader>` component
- Each module gets a relevant background image (reuse existing assets like `hero-warehouse.jpg`, `trade-workshop.jpg`, or generate new ones)
- Cards below get styled with the dark theme (teal accent borders on hover, graphite card backgrounds)

### 4. Update MainMenu page
**File**: `src/pages/MainMenu.tsx`
- Remove Profile and Sign Out buttons from the header (lines 95-103) — both in sidebar
- Replace the plain header with a visual welcome banner (gradient background, "PartsDoc Hub" branding, no back button needed)
- Style the module cards with teal accent hover effects and dark theme consistency

### 5. Ensure sidebar sub-items match index page options
**File**: `src/components/AppSidebar.tsx`
- Discovery sidebar currently missing: "Bulk Image Upload" and "Pending Images" items — add them
- Verify all other groups match their index page options

## Visual Pattern
Each module index page will look like:
```text
┌─────────────────────────────────────────────┐
│  [Background image with dark gradient]      │
│  ┃ Discovery                                │
│  ┃ See and manage products, brands...       │
├─────────────────────────────────────────────┤
│  ┌──────┐  ┌──────┐  ┌──────┐              │
│  │Card 1│  │Card 2│  │Card 3│  ...         │
│  └──────┘  └──────┘  └──────┘              │
└─────────────────────────────────────────────┘
```

## Files Modified
- **New**: `src/components/ModuleHeader.tsx`
- **Modified**: `src/pages/DashboardLayout.tsx`, `src/pages/MainMenu.tsx`, `src/pages/DiscoveryIndex.tsx`, `src/pages/IntelligenceIndex.tsx`, `src/pages/DecisionsIndex.tsx`, `src/pages/ExecutionIndex.tsx`, `src/pages/OperationsIndex.tsx`, `src/pages/AdminIndex.tsx`, `src/pages/DashboardsIndex.tsx`, `src/components/AppSidebar.tsx`

