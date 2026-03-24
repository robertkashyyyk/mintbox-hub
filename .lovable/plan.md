

# Fix Broken Links: Sidebar & Routing Audit

## Issues Found

### 1. `/main-menu` → should be `/menu`
**File**: `src/components/RbacSidebar.tsx` (line 130)
- The RBAC sidebar links "Main Menu" to `/main-menu`, but the route is `/menu`
- Fix: Change `to="/main-menu"` to `to="/menu"`

### 2. Missing routes — Operations sidebar & index cards link to pages that don't exist
**Sidebar** (`AppSidebar.tsx`) and **index page** (`OperationsIndex.tsx`) both link to:
- `/operations/sync-status` — **no route defined** → 404
- `/operations/system-health` — **no route defined** → 404

**Fix options**: Either add placeholder pages for these two, or remove the links from both the sidebar and the index page until they're built. I recommend removing them to avoid 404s, since the sidebar and cards should only show working links.

### 3. All other links verified OK
Every other sidebar link in `AppSidebar.tsx` maps to a defined route in `App.tsx`:
- Discovery (7 items) — all match
- Intelligence (4 items) — all match
- Decisions (4 items) — all match
- Execution (4 items) — all match
- Dashboards (3 items) — all match
- Administration (5 items) — all match (note: `/admin/integrations` has a route but isn't in sidebar — fine for now)
- Footer links (`/profile`, `/settings`) — both match

## Files Modified
- `src/components/RbacSidebar.tsx` — fix `/main-menu` → `/menu`
- `src/components/AppSidebar.tsx` — remove `Sync Status` and `System Health` items
- `src/pages/OperationsIndex.tsx` — remove `Sync Status` and `System Health` cards

