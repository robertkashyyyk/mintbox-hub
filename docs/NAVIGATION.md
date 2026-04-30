# Navigation — Canonical Route Map & Guidelines

> **Last updated:** 2026-04-02
> **Source of truth:** This document + `system_areas` table (RBAC) + `AppSidebar.tsx` (legacy fallback)

---

## Canonical Route Map

| Module | Page | Canonical Route | Sidebar Key |
|---|---|---|---|
| **Discovery** | *Index* | `/discovery` | `discovery` |
| | Products | `/discovery/products` | `discovery.products` |
| | Brands | `/discovery/brands` | `discovery.brands` |
| | Discovery Queue | `/discovery/discovery-queue` | `discovery.queue` |
| | Feed Imports | `/discovery/feed-imports` | `discovery.importing` |
| | Bulk Image Upload | `/discovery/bulk-images` | `discovery.bulk_images` |
| | Pending Images | `/discovery/pending-images` | `discovery.pending_images` |
| **Intelligence** | *Index* | `/intelligence` | `intelligence` |
| | Velocity & Coverage | `/intelligence/velocity` | `intelligence.velocity_coverage` |
| | Stock Health | `/intelligence/stock-health` | `intelligence.stock_health` |
| | Pricing Signals | `/intelligence/pricing` | `intelligence.pricing_signals` |
| | Seasonality | `/intelligence/seasonality` | `intelligence.seasonality` |
| **Decisions** | *Index* | `/decisions` | `decisions` |
| | Buy Recommendations | `/decisions/buying` | `decisions.buy_recommendations` |
| | Liquidation Candidates | `/decisions/liquidation` | `decisions.liquidation_candidates` |
| | Price Moves | `/decisions/price-moves` | `decisions.price_moves` |
| | Bundle Suggestions | `/decisions/bundles` | `decisions.bundle_suggestions` |
| **Execution** | *Index* | `/execution` | `execution` |
| | Purchase Order Builder | `/execution/purchase-orders` | `execution.purchase_orders` |
| | Price Hunter | `/execution/price-hunter` | `execution.price_hunter` |
| | Remote Stock Updates | `/execution/remote-stock-updates` | `execution.remote_stock_updates` |
| | Listing Cloner | `/execution/listing-cloner` | `execution.ebay_clone` |
| **Operations** | *Index* | `/operations` | `operations` |
| | Dashboard | `/operations/dashboard` | `operations.dashboard` |
| | Order Telemetry | `/operations/order-telemetry` | `operations.order_telemetry` |
| | Carriers | `/operations/carriers` | `operations.carriers` |
| | — Documents | `/operations/carriers/documents` | `operations.carriers.documents` |
| | — Penalties | `/operations/carriers/penalties` | `operations.carriers.penalties` |
| | — Remeasure Queue | `/operations/carriers/remeasure` | `operations.carriers.remeasure` |
| | — Settings | `/operations/carriers/settings` | `operations.carriers.settings` |
| | Reports | `/operations/reports` | `operations.reports` |
| | Monitoring | `/operations/monitoring` | `operations.monitoring` |
| **Dashboards** | *Index* | `/dashboards` | `dashboards` |
| | Warehouse Performance | `/dashboards/warehouse` | `dashboards.warehouse` |
| | Packing Area | `/dashboards/packing` | `dashboards.packing` |
| | Weekly Summary | `/dashboards/weekly` | `dashboards.weekly` |
| **Administration** | *Index* | `/admin` | `administration` |
| | User Management | `/admin/users` | `administration.user_management` |
| | API Access | `/admin/api-keys` | `administration.api_access` |
| | Billing & Usage | `/admin/billing` | `administration.billing_usage` |
| | Logs / Diagnostics | `/admin/logs` | `administration.logs` |
| | System Settings | `/admin/settings` | `administration.settings` |
| | Integrations | `/admin/integrations` | `administration.integrations` |
| **Footer** | Profile | `/profile` | — |
| | Settings | `/settings` | — |

---

## Adding a New Page

When adding a new page, update **all five** locations:

1. **`src/App.tsx`** — add a `<Route>` under the correct module section
2. **`src/components/AppSidebar.tsx`** — add item to the correct `navGroups` entry
3. **Module index page** (e.g. `OperationsIndex.tsx`) — add a tile card
4. **`system_areas` table** — add a row via migration (with correct `parent_key`, `route_path`, `sort_order`)
5. **`role_area_permissions` table** — add permission rows via migration (copy from parent or sibling)

### Naming conventions

- **Route pattern:** `/{module}/{kebab-case-page}` (e.g. `/operations/order-telemetry`)
- **RBAC key pattern:** `{module}.{snake_case_page}` (e.g. `operations.order_telemetry`)
- **Labels:** Use the same label in sidebar, tile, page heading, and `system_areas.label`

### Redirects

If renaming or moving a route, keep the old path as a `<Navigate to="..." replace />` in `App.tsx`. Never remove old routes without a redirect — users may have bookmarks.

---

## Navigation Regression Checklist

Use this checklist before merging any change that adds, moves, or renames a navigation item:

- [ ] **Sidebar item** points to the canonical route (not a redirect path)
- [ ] **Module tile** points to the same canonical route as the sidebar item
- [ ] **Page heading** matches the sidebar/tile label exactly
- [ ] **RBAC `system_areas` row** exists with correct `route_path` and `parent_key`
- [ ] **RBAC `role_area_permissions`** rows exist for the new area key
- [ ] **Legacy sidebar** (`AppSidebar.tsx`) has a matching entry with the same route and label
- [ ] **Old route** (if renamed/moved) exists only as a `<Navigate replace />` redirect
- [ ] **No redirect chains** — every visible link goes directly to the canonical URL
- [ ] **No duplicate routes** — only one `<Route>` renders the component; others redirect
- [ ] **`docs/NAVIGATION.md`** is updated with the new entry

---

## Architecture Notes

- **RBAC sidebar** (`RbacSidebar.tsx` + `menu_for_user` view) is the primary navigation when `use_rbac_navigation = true` in `app_settings`
- **Legacy sidebar** (`AppSidebar.tsx`) is the fallback when RBAC is off — it must mirror the same structure
- The `menu_for_user` view joins `system_areas` with `role_area_permissions` and the current user's RBAC roles to produce a filtered menu
- Module index pages (e.g. `OperationsIndex.tsx`) are standalone tile grids — they are not generated from the database
