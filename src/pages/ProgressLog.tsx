/**
 * ProgressLog — living record of what's built, what's in progress,
 * what's planned (hidden stubs), and what decisions are still open.
 *
 * This is a static/hardcoded page maintained by the dev team.
 * No database required — it's a project management artefact.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import ModuleHeader from "@/components/ModuleHeader";
import {
  CheckCircle2, Circle, Clock, XCircle,
  HelpCircle, ClipboardList, ChevronDown, ChevronRight, ExternalLink,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type Status = "live" | "in-progress" | "planned" | "decision-needed" | "retired";

interface LogItem {
  name: string;
  route?: string;
  notes: string;
  detail?: string;   // expanded detail shown on click — what's needed, blockers, context
  status: Status;
  section?: string;
}

// ── Data ─────────────────────────────────────────────────────────────────────

const ITEMS: LogItem[] = [

  // ── DISCOVERY ──────────────────────────────────────────────────────────────
  { section: "Discovery", name: "Products", route: "/discovery/products", status: "live", notes: "SKU database — search, filter, detail view. Solid." },
  { section: "Discovery", name: "Brands", route: "/discovery/brands", status: "live", notes: "Brand list with multipliers, prefix rules, SKU counts. Solid." },
  { section: "Discovery", name: "Discovery Queue", route: "/discovery/discovery-queue", status: "live", notes: "New SKUs from orders awaiting enrichment. Solid." },
  { section: "Discovery", name: "Feed Imports", route: "/discovery/feed-imports", status: "retired", notes: "Old one-shot data seeding tool. No longer used. Removed from nav. Route still exists.", detail: "Was used to seed initial product data from CSV/Excel files. Superseded by Mintsoft sync. The route (/discovery/feed-imports) is preserved so old bookmarks don't 404, but the page is not linked from anywhere in the nav." },
  { section: "Discovery", name: "Supplier Feeds", route: undefined, status: "planned", notes: "Major upcoming build. Live supplier price/stock feeds — underpins purchase ordering, pricing, stock health. Remote Stock Updates is part of this concept.", detail: "Needs to handle: (1) scheduled pulls of supplier stock/price CSVs or APIs, (2) mapping supplier SKUs to our SKUs, (3) storing last-known supplier price + stock for each SKU, (4) surfacing deltas to the purchasing team. Remote Stock Updates (/execution/remote-stock-updates) is the current placeholder — it should fold into this. Architecture decision pending: own top-level section or under Discovery?" },
  { section: "Discovery", name: "Images", route: undefined, status: "planned", notes: "Consolidate Bulk Image Upload + Pending Images + AI image finding (rebuilt Image Scout concept) into one unified Images area.", detail: "Three existing tools to merge: Bulk Image Upload (supplier batch uploads), Pending Images (review queue for matched images), and a rebuilt AI Image Scout (use AI/Firecrawl to find product images for SKUs that have none). Current Image Scout is wrong approach — 4 pages, complex, low success rate. New approach: simpler queue-based AI lookup. All under /discovery/images." },
  { section: "Discovery", name: "Bulk Image Upload", route: "/discovery/bulk-images", status: "live", notes: "Works. Needs a pass — should handle supplier batches and AI agent outputs cleanly.", detail: "Currently functional but basic. Needs: drag-and-drop multi-file, filename→SKU auto-matching, batch review before committing, and integration with the planned unified Images area." },
  { section: "Discovery", name: "Pending Images", route: "/discovery/pending-images", status: "decision-needed", notes: "Probably merges into the future Images area. Currently standalone.", detail: "Shows images uploaded but not yet confirmed/matched to a SKU. Decision: keep as standalone page or fold into the unified Images area as a tab/step in the review workflow?" },
  { section: "Discovery", name: "Box Quantities", route: "/discovery/box-quantities", status: "decision-needed", notes: "Belongs inside Products (informs purchase ordering logic) rather than a standalone nav item. No nav entry currently.", detail: "Box quantities (how many units per box) are used by the Purchase Orders feature to calculate order quantities. Currently a standalone page with no nav link. Decision: move into Products as a sub-tab, or keep as a utility page linked from Purchase Orders?" },
  { section: "Discovery", name: "Image Scout ×4", route: "/discovery/image-scout", status: "retired", notes: "Built but wrong approach. AI image finding concept is right — needs full rebuild as part of unified Images area. Routes still exist.", detail: "4 pages: Image Scout, Brand Profiles, QA Run, Calibration. Complex workflow with low success rate. Routes preserved at /discovery/image-scout/*. The core concept (AI-assisted product image finding) is valid and will be rebuilt as part of the unified Images area — but simpler, queue-based, and integrated." },

  // ── INTELLIGENCE ───────────────────────────────────────────────────────────
  { section: "Intelligence", name: "Profit Intelligence", route: "/intelligence/profit", status: "live", notes: "Weekly revenue, costs, channel fees, POR. Solid." },
  { section: "Intelligence", name: "Velocity & Coverage", route: "/intelligence/velocity", status: "live", notes: "Sales velocity and inventory coverage analysis. Solid." },
  { section: "Intelligence", name: "Stock Health", route: "/intelligence/stock-health", status: "live", notes: "Health classification MV — server-side quarantine filtering, live. Solid." },
  { section: "Intelligence", name: "Stock Valuation", route: "/intelligence/stock-valuation", status: "live", notes: "Cost × on-hand by SKU, brand and health category. Solid." },
  { section: "Intelligence", name: "Missing Costs", route: "/intelligence/missing-costs", status: "live", notes: "Active SKUs without a cost price. Also surfaced in Housekeeping." },
  { section: "Intelligence", name: "Dirt SKUs", route: "/intelligence/dirt-skus", status: "live", notes: "SKUs with invalid brand prefix separator. Also surfaced in Housekeeping." },
  { section: "Intelligence", name: "Pricing Signals", route: "/intelligence/pricing", status: "planned", notes: "Exists as a page but the feature is not ready. Hidden from nav and hub cards." },
  { section: "Intelligence", name: "Seasonality", route: "/intelligence/seasonality", status: "planned", notes: "Pure stub. Hidden from nav and hub cards." },

  // ── DECISIONS ──────────────────────────────────────────────────────────────
  { section: "Decisions", name: "Buy Recommendations", route: "/decisions/buying", status: "live", notes: "AI-driven purchase order suggestions based on velocity. Solid." },
  { section: "Decisions", name: "Purchase Orders", route: "/execution/purchase-orders", status: "live", notes: "Create and manage POs for suppliers. Moved here from Execution. Solid." },
  { section: "Decisions", name: "LSA Calibration", route: "/decisions/lsa-calibration", status: "live", notes: "Per-brand low-stock alert thresholds and calibration. Solid." },
  { section: "Decisions", name: "3D Reprice", route: "/decisions/threeds-reprice", status: "in-progress", notes: "Tier-based repricer (Lite). Pick a store + 'Move to' tier; suggests the inc-VAT price that lands each SKU in that band, then pushes via SFTP. Pricing maths settled; blocked on the 3D Sellers write-path decision (see Open Decisions).", detail: "Working: 'Move to' tier selector (Breakeven→Amazing) drives a proper back-solve P=(C+F)/(1/v−r−t) using cost, courier, channel fee % + fixed fee and VAT from channel_fee_rules — outputs the GROSS (inc-VAT) price, fixing the old VAT/under-correction bug. Pagination (50/page). Zero-cost and implausibly-high-cost SKUs are split into a 'Flagged — fix cost' table and excluded from repricing. Pure maths lives in src/lib/reprice.ts. Write channel = existing SFTP CSV (SKU,Price) per store. Still to do: confirm 3DS push behaviour, and verify the §7 Q-code/bundle cost transformation upstream (products_cache often holds per-variant costs that are 0 or wrong)." },
  { section: "Decisions", name: "Liquidation Candidates", route: "/decisions/liquidation", status: "planned", notes: "Products recommended for clearance or fire sale. Stub hidden from nav. Route preserved.", detail: "Will pull from Stock Health — Extreme Overstock + Dead Stock categories — and surface candidates with suggested clearance prices based on cost price and holding cost. Depends on Pricing Signals being built first." },
  { section: "Decisions", name: "Price Moves", route: "/decisions/price-moves", status: "planned", notes: "Suggested pricing adjustments. Stub hidden from nav. Route preserved.", detail: "Depends on Pricing Signals (Intelligence) being live first. Will surface SKUs where our price is significantly above/below market average and recommend adjustments with expected revenue impact." },
  { section: "Decisions", name: "Bundle Suggestions", route: "/decisions/bundles", status: "planned", notes: "Product bundling opportunities. Stub hidden from nav. Route preserved.", detail: "Will analyse order history to find SKUs frequently bought together and surface as bundle opportunities. Requires sufficient order history data (~6 months minimum)." },
  { section: "Decisions", name: "Price Hunter", route: "/execution/price-hunter", status: "planned", notes: "eBay price checks and automated pricing. Not ready. Hidden from nav.", detail: "Scrapes or pulls competitor eBay prices for our SKUs and compares to our listing prices. Includes an Ignored Sellers list and Ignored Listings list. Was partially built — route exists, underlying data model unclear. Needs a requirements pass before continuing." },
  { section: "Decisions", name: "Listing Cloner", route: "/execution/listing-cloner", status: "planned", notes: "eBay listing templates. Not ready. Hidden from nav.", detail: "Intended to clone eBay listing templates across multiple product variations. Route exists (/execution/listing-cloner). Long-term home is unclear — it's a utility rather than a decision tool. Could move to Admin or Discovery." },

  // ── OPERATIONS ─────────────────────────────────────────────────────────────
  { section: "Operations", name: "Order Telemetry", route: "/operations/order-telemetry", status: "live", notes: "Live order pipeline — in, despatched, backlog, issues. Needs further work." },
  { section: "Operations", name: "Carriers", route: "/operations/carriers", status: "in-progress", notes: "Royal Mail / courier penalties, documents, remeasure queue. Live but in beta testing." },
  { section: "Operations", name: "SKU Analysis", route: "/operations/sku-analysis", status: "live", notes: "Top problem SKUs, backorder concentration, brand breakdown." },
  { section: "Operations", name: "Reports", route: "/operations/reports", status: "live", notes: "Weekly ops reports and subscriber management." },
  { section: "Operations", name: "Remote Stock Updates", route: "/execution/remote-stock-updates", status: "decision-needed", notes: "Currently under old Execution path. This is part of the Supplier Feeds concept — needs to move once Feeds is built." },

  // ── DASHBOARDS ─────────────────────────────────────────────────────────────
  { section: "Dashboards", name: "Operations Dashboard", route: "/operations/dashboard", status: "live", notes: "Live operational control panel. Moved from Operations section." },
  { section: "Dashboards", name: "Trends", route: "/operations/trends", status: "live", notes: "Historical performance charts. Moved from Operations section." },
  { section: "Dashboards", name: "Warehouse Performance", route: "/dashboards/warehouse", status: "live", notes: "Real-time warehouse overview. Needs accuracy/usefulness review." },
  { section: "Dashboards", name: "Packing Area Display", route: "/dashboards/packing", status: "live", notes: "Packing station metrics. Needs accuracy/usefulness review." },
  { section: "Dashboards", name: "Weekly Summary", route: "/dashboards/weekly", status: "live", notes: "Week-over-week performance. Needs accuracy/usefulness review." },
  { section: "Dashboards", name: "Back Orders", route: "/dashboards/backorders", status: "live", notes: "Back-order volume over time. Needs accuracy/usefulness review." },

  // ── HOUSEKEEPING ───────────────────────────────────────────────────────────
  { section: "Housekeeping", name: "Missing Costs", route: "/intelligence/missing-costs", status: "live", notes: "Links to Intelligence page. Count badge live." },
  { section: "Housekeeping", name: "Dirt SKUs", route: "/intelligence/dirt-skus", status: "live", notes: "Links to Intelligence page. Count badge live." },
  { section: "Housekeeping", name: "Pending Images", route: "/discovery/pending-images", status: "live", notes: "Count badge live. Future: merge into Images area." },
  { section: "Housekeeping", name: "Discovery Queue", route: "/discovery/discovery-queue", status: "live", notes: "Count badge live." },
  { section: "Housekeeping", name: "Missing Barcodes", route: "/discovery/products?filter=no-barcode", status: "live", notes: "Count badge live." },
  { section: "Housekeeping", name: "Carrier Remeasure", route: "/operations/carriers/remeasure", status: "in-progress", notes: "Beta — carrier is in testing." },
  { section: "Housekeeping", name: "Orphan SKUs", route: "/housekeeping/orphan-skus", status: "live", notes: "SKUs not linked to a Mintsoft Product ID." },
  { section: "Housekeeping", name: "LSA Unmatched SKUs", route: "/housekeeping/lsa-unmatched", status: "live", notes: "SKUs in LSA file not in cache." },

  // ── TASKS & GOVERNANCE ─────────────────────────────────────────────────────
  { section: "Tasks & Governance", name: "Today", route: "/tasks", status: "in-progress", notes: "Default landing of the task environment — Overdue / Due Today / Up Next / Done Today, ranked by composite score. Phase 1 scaffold built; pending migration apply.", detail: "Lives in a distinct teal 'focus mode' layout (TasksLayout) with its own slim sidebar, separate from the main Hub chrome. Sections are derived client-side from the get_today_tasks() RPC. Priority (human, 1–5) and Urgency (machine, 0–100) are kept as two separate axes; the queue ranks on sort_score = urgency×0.6 + (6−priority)×10×0.4. Migration 20260601150000 must be applied + Supabase types regenerated before this reads live data." },
  { section: "Tasks & Governance", name: "My Tasks", route: "/tasks/my", status: "in-progress", notes: "Full personal queue (created by OR assigned to me) with search + status/priority filters. Phase 1 scaffold.", detail: "Reads the tasks_with_sort_score view via RLS (own + super/senior). Filtering is server-side for status/priority, client-side for free text." },
  { section: "Tasks & Governance", name: "All Tasks", route: "/tasks/all", status: "in-progress", notes: "Team-wide oversight view grouped by assignee. Super/senior only. Phase 1 scaffold.", detail: "Visibility enforced by RLS (has_any_role super_user/senior_user) and gated in the task layout nav." },
  { section: "Tasks & Governance", name: "Create / Task Detail", route: "/tasks/new", status: "in-progress", notes: "Create form with the deprioritisation warning (high-priority tasks that would displace your top 5), plus a detail page with inline status/priority, comments and an activity timeline.", detail: "Ambient capture also available via the header Task Drawer (CheckSquare icon) — Today + Quick Add tabs with a live open-task badge driven by Supabase Realtime. All writes flow through audited mutation hooks." },
  { section: "Tasks & Governance", name: "Urgency engine + scheduled recalc", route: undefined, status: "in-progress", notes: "DB-side compute_urgency_score() recomputed on every write AND on a 15-min pg_cron sweep — because time-based signals (overdue, due-proximity, stalled) don't fire on field changes.", detail: "Inputs: overdue +35, due ≤24h +30 / ≤48h +20 / ≤72h +10, stalled in-progress >3 days +15, urgency flag +10, system-generated +10, priority 4 −10 / 5 −20, clamped 0–100. The cron job (recalc-task-urgency-15min) is guarded on the pg_cron extension being present. Defined in migration 20260601150000." },
  { section: "Tasks & Governance", name: "Audit Log", route: "/audit", status: "in-progress", notes: "Append-only governance ledger — who changed what, with before/after values. Read-only viewer with search + action-type filter. Super/senior only.", detail: "Append-only is enforced two ways: RLS has INSERT + SELECT policies but deliberately NO UPDATE/DELETE, and the authenticated role is granted only SELECT, INSERT. logAuditEvent() is the app-layer write path; a DB-trigger backstop on the highest-sensitivity tables (cost price, roles, API keys, PO state) is a planned follow-up so changes are captured even when they bypass the app." },

  // ── DECISIONS OPEN ─────────────────────────────────────────────────────────
  { section: "Open Decisions", name: "Task Manager: default landing", status: "decision-needed", notes: "Spec wants /tasks as the post-login landing. Deferred until the migration is applied — flipping it early would drop users on pages that query not-yet-existing tables.", detail: "Auth.tsx currently redirects to /menu (or the saved 'from' path). Once 20260601150000 + 20260601150100 are applied to the target Supabase project and types are regenerated, switch the default landing to /tasks per spec §10." },
  { section: "Open Decisions", name: "Audit Log DB-trigger backstop", status: "decision-needed", notes: "App-layer logAuditEvent is only as complete as developer discipline. High-sensitivity tables need a DB-trigger that ALSO writes audit_log.", detail: "Follow-up migration: BEFORE/AFTER triggers on cost-price, user_roles/RBAC, API-key, and PO-state tables that insert into public.audit_log, so the ledger captures changes made via SQL/admin tools or other code paths, not just the React app." },
  { section: "Open Decisions", name: "Supplier Feeds architecture", status: "decision-needed", notes: "Where does Feeds live? Its own top-level section, or under Discovery? Remote Stock Updates needs to fold into it.", detail: "Options: (A) Top-level 'Feeds' section — signals its importance, keeps Discovery clean. (B) Under Discovery as a major item — keeps everything catalogue-related together. Leaning toward A given the scope. Remote Stock Updates at /execution/remote-stock-updates is the current placeholder and should redirect to wherever Feeds lands." },
  { section: "Open Decisions", name: "Images consolidation", status: "decision-needed", notes: "Bulk Upload + Pending Images + AI image finding. Build as one unified area under Discovery?", detail: "Three tools currently scattered: /discovery/bulk-images (upload), /discovery/pending-images (review queue), /discovery/image-scout (AI finder, retired). Proposal: unified /discovery/images with tabs — Upload, Review, AI Scout. Needs design pass before build." },
  { section: "Open Decisions", name: "Box Quantities placement", status: "decision-needed", notes: "Move into Products as a tab or sub-feature rather than standalone nav item?", detail: "Box quantities (units per box) are set per SKU and used by Purchase Orders to calculate order sizes. Currently at /discovery/box-quantities with no nav link. Options: (A) Tab inside Products detail page, (B) Sub-section of Purchase Orders flow, (C) Keep standalone but add nav link. Recommend A." },
  { section: "Open Decisions", name: "Missing Costs / Dirt SKUs in Intelligence nav", status: "decision-needed", notes: "These are data quality issues, not analysis. Should they move to Housekeeping-only in nav, or stay in Intelligence too?", detail: "Both pages are currently in Intelligence nav AND surfaced as cards in Housekeeping. Housekeeping is the right 'action' home (it's the to-do board). Intelligence pages are more 'analytical'. Decision: keep both? Or remove from Intelligence nav and point Intelligence hub card to Housekeeping?" },
  { section: "Open Decisions", name: "Dashboards accuracy review", status: "decision-needed", notes: "All four original dashboards need a pass for data accuracy and usefulness.", detail: "Warehouse Performance, Packing Area Display, Weekly Summary, Back Orders — all live but not validated for data accuracy. Need a session with the warehouse team to confirm: (1) the right metrics are shown, (2) the numbers match ground truth, (3) refresh rates are appropriate for wall-display use." },
  { section: "Open Decisions", name: "Repricer write path / source of truth", status: "decision-needed", notes: "Does a 3D Sellers price write auto-push to eBay, or only stage it (the manual 'Update changes' click)? And is the live per-listing eBay price readable for verification?", detail: "Discovery (Jun 2026): the visible 3DS v1 API exposes /v1/products only — a single-price master catalogue with no eBay item number, no by-id read, no publish/sync status. So 'write to 3DS → read back live eBay price' can't be built on that surface. Emailed 3D Sellers; awaiting reply. The Lite repricer sidesteps this by writing the proven SFTP CSV (SKU,Price) instead. Fallbacks for verification: tag→human-clicks-Update→untag; or read live price from eBay directly via externalItemId from the orders feed." },
  { section: "Open Decisions", name: "Cost-data quality (repricer prerequisite)", status: "decision-needed", notes: "~28% of products_cache rows have cost_price = 0, and many have an implausibly high cost (pack/case cost stored on a single-unit listing), producing fake loss-makers. The repricer can only be as good as the cost data.", detail: "Verified in the live DB Jun 2026: 63,123/225,385 rows have cost_price = 0; examples like a £2.42 washer carrying a £22.15 cost dominate the 'loss-makers' list. The 3D Reprice page now flags these (missing cost / suspect cost) and excludes them from repricing, but the underlying fix is data-side: correct the catalogue costs and implement the §7 Q-code/bundle cost transformation (Q03 = 3× unit, bundle = Σ components). Arguably higher-leverage than the repricer itself." },
  { section: "Open Decisions", name: "Listing Cloner long-term home", status: "decision-needed", notes: "Doesn't fit cleanly in Decisions (it's a utility). Admin? Discovery? Standalone?", detail: "The Listing Cloner (/execution/listing-cloner) creates eBay listing templates from existing listings. It's operational/tooling, not a decision. Candidates for home: (A) Under Discovery (catalogue tooling), (B) Under Admin as a utility, (C) New 'Tools' or 'Marketplace' section if we add more eBay-adjacent tools. Decision deferred until eBay tooling direction is clearer." },
];

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<Status, { label: string; color: string; icon: React.ElementType }> = {
  "live":             { label: "Live",           color: "bg-green-500/15 text-green-600 border-green-500/30",   icon: CheckCircle2 },
  "in-progress":      { label: "In Progress",    color: "bg-blue-500/15 text-blue-500 border-blue-500/30",     icon: Clock },
  "planned":          { label: "Planned",        color: "bg-amber-500/15 text-amber-500 border-amber-500/30",  icon: Circle },
  "decision-needed":  { label: "Decision Needed",color: "bg-purple-500/15 text-purple-500 border-purple-500/30", icon: HelpCircle },
  "retired":          { label: "Retired",        color: "bg-muted/40 text-muted-foreground border-border",     icon: XCircle },
};

const SECTION_ORDER = ["Discovery", "Intelligence", "Decisions", "Operations", "Dashboards", "Housekeeping", "Tasks & Governance", "Open Decisions"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

function countsByStatus(items: LogItem[]) {
  const counts: Partial<Record<Status, number>> = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
}

// ── Row component with expand/collapse ───────────────────────────────────────

function LogRow({ item, isLast }: { item: LogItem; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(item.detail);

  return (
    <div>
      <div
        className={`flex items-start gap-3 py-3 ${hasDetail ? "cursor-pointer hover:bg-muted/20 rounded-md px-2 -mx-2 transition-colors" : "px-0"}`}
        onClick={() => hasDetail && setOpen(o => !o)}
      >
        {/* Expand chevron */}
        <div className="flex-shrink-0 mt-0.5 w-4">
          {hasDetail ? (
            open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : null}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{item.name}</span>
            {item.route && (
              <span className="text-xs text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">{item.route}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.notes}</p>

          {/* Expanded detail */}
          {open && item.detail && (
            <div className="mt-2 text-xs text-foreground/70 leading-relaxed bg-muted/30 rounded-md p-3 border border-border/50">
              {item.detail}
              {item.route && (
                <a
                  href={item.route}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-1 mt-2 text-pd-accent hover:text-pd-accent-light text-xs w-fit"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open {item.route}
                </a>
              )}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 mt-0.5">
          <StatusBadge status={item.status} />
        </div>
      </div>
      {!isLast && <Separator className="opacity-40" />}
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

const ProgressLog = () => {
  const grouped = SECTION_ORDER.map(section => ({
    section,
    items: ITEMS.filter(i => i.section === section),
  })).filter(g => g.items.length > 0);

  const totals = countsByStatus(ITEMS);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Progress Log"
        description="Living record of what's built, what's in progress, what's planned, and what decisions are still open."
        icon={ClipboardList}
      />

      {/* Summary bar */}
      <div className="flex flex-wrap gap-3">
        {(Object.entries(STATUS_CONFIG) as [Status, typeof STATUS_CONFIG[Status]][]).map(([status, cfg]) => {
          const n = totals[status] ?? 0;
          if (!n) return null;
          const Icon = cfg.icon;
          return (
            <div key={status} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${cfg.color}`}>
              <Icon className="h-4 w-4" />
              <span>{cfg.label}</span>
              <span className="font-bold">{n}</span>
            </div>
          );
        })}
      </div>

      {/* Sections */}
      {grouped.map(({ section, items }) => (
        <Card key={section}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {section}
              <span className="text-xs font-normal text-muted-foreground">({items.length} items)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-0">
              {items.map((item, idx) => (
                <LogRow key={item.name} item={item} isLast={idx === items.length - 1} />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground pb-4">
        Last updated: 2 June 2026 · Maintained in <code className="font-mono">src/pages/ProgressLog.tsx</code> · Click any row with a chevron for detail.
      </p>
    </div>
  );
};

export default ProgressLog;
