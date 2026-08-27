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
  CheckCircle2, Circle, Clock, XCircle, Activity,
  HelpCircle, ClipboardList, ChevronDown, ChevronRight, ExternalLink,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type Status = "live" | "in-progress" | "testing" | "planned" | "decision-needed" | "retired";

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
  { section: "Discovery", name: "Images", route: "/discovery/images", status: "live", notes: "Unified Images area with 3 tabs: Bulk Upload, Pending Review (with count badge), and AI Scout (planned stub). Old /discovery/bulk-images and /discovery/pending-images now redirect here.", detail: "Built Jun 2026. Bulk Upload tab contains the supplier batch upload workflow (drag-and-drop, filename→SKU matching). Pending Review tab shows images uploaded but not yet confirmed, with a live count badge. AI Scout tab is a placeholder — the concept (queue-based AI lookup for SKUs with no image) is planned but not built. Old routes /discovery/bulk-images and /discovery/pending-images preserved as redirects." },
  { section: "Discovery", name: "Bulk Image Upload", route: "/discovery/bulk-images", status: "retired", notes: "Merged into unified Images page (/discovery/images). Old route redirects there. No longer a standalone page.", detail: "Was a standalone page for supplier batch image uploads. Logic now lives in the Bulk Upload tab of /discovery/images. Route /discovery/bulk-images redirects to /discovery/images." },
  { section: "Discovery", name: "Pending Images", route: "/discovery/pending-images", status: "retired", notes: "Merged into unified Images page (/discovery/images) as the Pending Review tab. Old route redirects there.", detail: "Was a standalone review queue for unconfirmed image matches. Logic now lives in the Pending Review tab of /discovery/images. Route /discovery/pending-images redirects to /discovery/images?tab=pending-review." },
  { section: "Discovery", name: "Box Quantities", route: "/discovery/products", status: "live", notes: "Moved into Products as a sub-tab. 785 NGK SKUs imported Jun 2026. No longer a standalone nav item.", detail: "Box quantities (units per box) used by Purchase Orders to calculate order sizes. Now lives as the 'Box Quantities' tab inside /discovery/products. NGK bulk import: 785 SKUs updated from CSV (values of 4 or 10 per SKU). Old standalone route /discovery/box-quantities preserved." },
  { section: "Discovery", name: "Image Scout ×4", route: "/discovery/image-scout", status: "retired", notes: "Built but wrong approach. AI image finding concept is right — placeholder now inside unified Images page. Routes still exist.", detail: "4 pages: Image Scout, Brand Profiles, QA Run, Calibration. Complex workflow with low success rate. Routes preserved at /discovery/image-scout/*. The core concept (AI-assisted product image finding) is valid and will be rebuilt as the AI Scout tab in /discovery/images — simpler, queue-based, integrated." },

  // ── INTELLIGENCE ───────────────────────────────────────────────────────────
  { section: "Intelligence", name: "Contribution Intelligence", route: "/intelligence/profit", status: "live", notes: "Weekly revenue, costs, channel fees, POR. Clickable order lines → full detail. Backed by order_line_economics — now a materialised view (6-hourly refresh), so reads are instant (was timing out)." },
  { section: "Intelligence", name: "Standing Reports", route: "/intelligence/standing-reports", status: "live", notes: "Recurring reports tracked over time. Tabs: Repricing Payoff (volume-aware value created, cumulative + per-day, by account; excludes liquidation) and 80:20 Contribution (base-SKU leaderboard). Daily snapshots." },
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
  { section: "Decisions", name: "3D Reprice", route: "/decisions/threeds-reprice", status: "live", notes: "Tier-based repricer driven by real 3DS economics. Semi-Manual (pick store or All stores, choose tier) + Auto-Report (daily cross-account snapshot). Push to 3D via SFTP confirmed working end-to-end.", detail: "Back-solves the inc-VAT price for the chosen POR tier using real per-listing eBay fee (from 3DS), pack-aware cost, postage-as-income, courier. Never suggests below current; >1.5× moves flagged for review (Outstanding/Review/All filter). 'All stores' mode unions every enabled account, tags each row with its store, and splits the push per store. Cumulative SFTP push + nightly reconcile. Dirt-SKU resolution: old eBay labels (e.g. DV_29045) auto-resolve to the true SKU for cost via threeds_sku_aliases. Candidate list ordered by POR (margin). Flagged 'fix cost' table excludes 0/suspect costs. Known: candidate RPC ~8s (its own 3DS-tx scan; functional, deprioritised)." },
  { section: "Decisions", name: "Liquidation Candidates", route: "/decisions/liquidation", status: "live", notes: "Dead/slow stock by capital tied up. One-click or bulk clearance campaigns: ring-fence the SKU from the repricer, push a discounted price via 3D/SFTP, revertible. Sale-vs-Liquidation intents + Sale Review loop (Phase A).", detail: "Ranks by capital tied up; suggested discount depth by how dead the SKU is; per-store/pack listing resolution; price_campaigns + price_campaign_listings track baseline velocity/stock/cost, orig→sale, pushed/reverted. Clearance pushes are tagged source='liquidation' so they DON'T pollute the Repricing Payoff report. Brands + Graphs tabs (weekly capital-shrink trend). Phase B (listing-coverage / Unlisted report) pending a per-channel listings feed." },
  { section: "Decisions", name: "FBA Replenishment", route: "/decisions/fba-replenishment", status: "live", notes: "What to ship into Amazon FBA — weekly velocity vs current FBA on-hand + inbound, MOQ-rounded reorder quantities, per-unit net margin. Now honours never-FBA exclusions (won't recommend restocking a blown-out SKU).", detail: "Backed by amazon.v_fba_replenishment: target = target_weeks_cover × weekly velocity, minus FBA on-hand + in-transit, rounded up to MOQ. Joins mv_sku_economics for avg sell price, referral %, FBA fee/unit → net-per-unit + net-margin. Jul 2026: pack-aware (Q-codes decompose to atom × pack for both stock and velocity) and it now excludes SKUs flagged in amazon.fba_switch_exclusions — their reorder is zeroed and a never_fba flag surfaced, so the Blow-Out 'stop FBA' action actually sticks (was previously written but ignored — 9 flagged SKUs were still being recommended)." },
  { section: "Decisions", name: "FBA Blow-Out", route: "/decisions/fba-blowout", status: "live", notes: "Clear stock stuck in FBA — items we hold, don't win the Buy Box, and could only win it at a loss. Select → drop the eSagu min to £0.01 to sell through, and flag never-FBA so it isn't restocked. Reversible review tab. Built Jul 2026.", detail: "'Stuck at FBA' list from get_fba_blowout_candidates(): FBA on-hand > 0, we_win = false (amazon.esagu_buybox_snapshot), and break-even floor > live Buy Box price. Bulk 'Blow out & stop FBA' creates a liquidation price_campaign at £0.01, applies it via the esagu-clearance edge fn (repricer chases the Buy Box down to clear the stock), and calls amazon_flag_never_fba — eBay/FBM sales continue, only FBA restocking stops. 'Blown out' review tab (get_fba_blowout_review) shows FBA on-hand draining, units sold + realised P/L since, with a per-SKU Restore (revert the eSagu floor + clear never-FBA). Migrations 20260709120000/130000; review RPC later optimised 11s→0.6s (materialised the economics scan) and an on-hand double-count fixed (esagu_item has duplicate rows per ASIN)." },
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
  { section: "Housekeeping", name: "Missing Barcodes", route: "/housekeeping/missing-barcodes", status: "live", notes: "Standalone page: active products with no barcode; inline entry detects UPC (12) vs EAN (13) and pushes the correct Mintsoft field. Count badge live." },
  { section: "Housekeeping", name: "Dirt SKUs on eBay", route: "/housekeeping/dirt-listings", status: "live", notes: "Live eBay listings whose custom label is an old dirt code mapped to a true SKU. Cost/repricing auto-resolved (threeds_sku_aliases); this lists them to fix at source. Report + 3D-update (Current SKU→True SKU) CSV exports.", detail: "Backed by get_dirt_listings() over the alias table; shows store, eBay item link, units/revenue 90d, true product+cost. Manual upload / SFTP fix today; automated SFTP push pending the 3D import-template build." },
  { section: "Housekeeping", name: "Carrier Remeasure", route: "/operations/carriers/remeasure", status: "in-progress", notes: "Beta — carrier is in testing." },
  { section: "Housekeeping", name: "Orphan SKUs", route: "/housekeeping/orphan-skus", status: "live", notes: "SKUs not linked to a Mintsoft Product ID." },
  { section: "Housekeeping", name: "LSA Unmatched SKUs", route: "/housekeeping/lsa-unmatched", status: "live", notes: "SKUs in LSA file not in cache." },

  // ── TASKS & GOVERNANCE ─────────────────────────────────────────────────────
  { section: "Tasks & Governance", name: "Today", route: "/tasks", status: "live", notes: "Default landing of the task environment — Overdue / Due Today / Up Next / Done Today, ranked by composite score. Migrations applied Jun 2026.", detail: "Lives in a distinct teal 'focus mode' layout (TasksLayout) with its own slim sidebar, separate from the main Hub chrome. Sections are derived client-side from the get_today_tasks() RPC. Priority (human, 1–5) and Urgency (machine, 0–100) are kept as two separate axes; the queue ranks on sort_score = urgency×0.6 + (6−priority)×10×0.4. Migrations 20260601150000, 20260601150100, 20260601150200 applied to vcfbegjpkvxkqpptyxni." },
  { section: "Tasks & Governance", name: "My Tasks", route: "/tasks/my", status: "live", notes: "Full personal queue (created by OR assigned to me) with search + status/priority filters. Live.", detail: "Reads the tasks_with_sort_score view via RLS (own + super/senior). Filtering is server-side for status/priority, client-side for free text." },
  { section: "Tasks & Governance", name: "All Tasks", route: "/tasks/all", status: "live", notes: "Team-wide oversight view grouped by assignee. Super/senior only. Live.", detail: "Visibility enforced by RLS (has_any_role super_user/senior_user) and gated in the task layout nav." },
  { section: "Tasks & Governance", name: "Create / Task Detail", route: "/tasks/new", status: "live", notes: "Create form with deprioritisation warning + detail page with inline status/priority, comments, activity timeline. Live.", detail: "Ambient capture also available via the header Task Drawer (CheckSquare icon) — Today + Quick Add tabs with a live open-task badge driven by Supabase Realtime. All writes flow through audited mutation hooks. Data-layer casts tightened onto regenerated Supabase types (Jun 2026)." },
  { section: "Tasks & Governance", name: "Urgency engine + scheduled recalc", route: undefined, status: "live", notes: "DB-side compute_urgency_score() recomputed on every write AND on a 15-min pg_cron sweep. Live.", detail: "Inputs: overdue +35, due ≤24h +30 / ≤48h +20 / ≤72h +10, stalled in-progress >3 days +15, urgency flag +10, system-generated +10, priority 4 −10 / 5 −20, clamped 0–100. The cron job (recalc-task-urgency-15min) is guarded on the pg_cron extension being present. Defined in migration 20260601150000." },
  { section: "Tasks & Governance", name: "Audit Log", route: "/audit", status: "live", notes: "Append-only governance ledger — who changed what, with before/after values. Read-only viewer with search + action-type filter. Super/senior only. Live.", detail: "Append-only is enforced two ways: RLS has INSERT + SELECT policies but deliberately NO UPDATE/DELETE, and the authenticated role is granted only SELECT, INSERT. logAuditEvent() is the app-layer write path. DB-trigger backstop (20260601150200) covers cost price, user_roles, API keys, and PO state tables — fires on changes that bypass the app layer too." },
  { section: "Tasks & Governance", name: "Stock Count Game", route: "/games/scg", status: "testing", notes: "Gamified warehouse stock-count tool — surfaces never-counted SKUs, records counts, pushes on-hand quantities back to Mintsoft via stocktake-sync edge function. In testing.", detail: "Built Jun 2026. Picks SKUs that have never been counted (or not counted recently), presents them one at a time in a game-style UI. Counts stored in DB; stocktake-sync edge function deployed to vcfbegjpkvxkqpptyxni — pushes Product/BulkOnHandStockUpdate to Mintsoft. Open item: confirm exact field names for BulkOnHandStockUpdate (currently sending ProductId, WarehouseId, OnHand — needs verification against Mintsoft API docs or a live test response)." },

  // ── DECISIONS OPEN ─────────────────────────────────────────────────────────
  { section: "Open Decisions", name: "Task Manager: default landing", status: "live", notes: "✅ Resolved Jun 2026 — migrations applied, /tasks is now the live environment.", detail: "Migrations 20260601150000/150100/150200 applied to vcfbegjpkvxkqpptyxni. Auth.tsx can now be updated to redirect to /tasks as the post-login default per spec §10 if desired." },
  { section: "Open Decisions", name: "Audit Log DB-trigger backstop", status: "live", notes: "✅ Resolved Jun 2026 — migration 20260601150200 committed. Triggers cover cost_price, user_roles, API keys, PO state.", detail: "Migration 20260601150200_audit_trigger_backstop.sql committed. DB-level BEFORE/AFTER triggers on high-sensitivity tables write to public.audit_log independently of the app layer. Applies alongside the other Task Manager migrations." },
  { section: "Open Decisions", name: "Supplier Feeds architecture", status: "decision-needed", notes: "Where does Feeds live? Its own top-level section, or under Discovery? Remote Stock Updates needs to fold into it.", detail: "Options: (A) Top-level 'Feeds' section — signals its importance, keeps Discovery clean. (B) Under Discovery as a major item — keeps everything catalogue-related together. Leaning toward A given the scope. Remote Stock Updates at /execution/remote-stock-updates is the current placeholder and should redirect to wherever Feeds lands." },
  { section: "Open Decisions", name: "Images consolidation", status: "live", notes: "✅ Resolved Jun 2026 — unified /discovery/images built with Bulk Upload, Pending Review, and AI Scout (stub) tabs. Old routes redirect.", detail: "Decision was: build one unified /discovery/images with tabs. Done. Bulk Upload and Pending Images merged in as tabs. AI Scout is a placeholder tab ready for the queue-based implementation when built." },
  { section: "Open Decisions", name: "Box Quantities placement", status: "live", notes: "✅ Resolved Jun 2026 — moved into Products as a sub-tab. NGK bulk import (785 SKUs) done.", detail: "Decision was: tab inside Products (option A). Done — Box Quantities is now the second tab in /discovery/products. NGK box quantity CSV (791 rows, 785 valid) imported into products_cache.box_quantity Jun 2026." },
  { section: "Open Decisions", name: "Missing Costs / Dirt SKUs in Intelligence nav", status: "retired", notes: "RESOLVED 2026-06-18: per-item — cleanup/data-quality items live in Housekeeping; duplicated sidebar entries (Dirt SKUs, Images, Discovery Queue) de-duped. Intelligence keeps the analytical pages." },
  { section: "Open Decisions", name: "Dashboards accuracy review", status: "decision-needed", notes: "All four original dashboards need a pass for data accuracy and usefulness.", detail: "Warehouse Performance, Packing Area Display, Weekly Summary, Back Orders — all live but not validated for data accuracy. Need a session with the warehouse team to confirm: (1) the right metrics are shown, (2) the numbers match ground truth, (3) refresh rates are appropriate for wall-display use." },
  { section: "Open Decisions", name: "Repricer write path / source of truth", status: "retired", notes: "RESOLVED 2026-06-18: write path = SFTP CSV (SKU,Price) per store, confirmed working end-to-end (push → 3D scheduled import → live on eBay, proven via sales at new prices). Verification = nightly reconcile clears the pending queue after the import window. No dependency on the limited 3DS v1 API." },
  { section: "Open Decisions", name: "Cost-data quality (repricer prerequisite)", status: "decision-needed", notes: "~28% of products_cache rows have cost_price = 0, and many have an implausibly high cost (pack/case cost stored on a single-unit listing), producing fake loss-makers. The repricer can only be as good as the cost data.", detail: "Verified in the live DB Jun 2026: 63,123/225,385 rows have cost_price = 0; examples like a £2.42 washer carrying a £22.15 cost dominate the 'loss-makers' list. The 3D Reprice page now flags these (missing cost / suspect cost) and excludes them from repricing, but the underlying fix is data-side: correct the catalogue costs and implement the §7 Q-code/bundle cost transformation (Q03 = 3× unit, bundle = Σ components). Arguably higher-leverage than the repricer itself." },
  { section: "Open Decisions", name: "Listing Cloner long-term home", status: "decision-needed", notes: "Doesn't fit cleanly in Decisions (it's a utility). Admin? Discovery? Standalone?", detail: "The Listing Cloner (/execution/listing-cloner) creates eBay listing templates from existing listings. It's operational/tooling, not a decision. Candidates for home: (A) Under Discovery (catalogue tooling), (B) Under Admin as a utility, (C) New 'Tools' or 'Marketplace' section if we add more eBay-adjacent tools. Decision deferred until eBay tooling direction is clearer." },
];

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<Status, { label: string; color: string; icon: React.ElementType }> = {
  "live":             { label: "Live",           color: "bg-green-500/15 text-green-600 border-green-500/30",   icon: CheckCircle2 },
  "in-progress":      { label: "In Progress",    color: "bg-blue-500/15 text-blue-500 border-blue-500/30",     icon: Clock },
  "testing":          { label: "Testing",        color: "bg-orange-500/15 text-orange-500 border-orange-500/30", icon: Activity },
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
        Last updated: 18 June 2026 · Maintained in <code className="font-mono">src/pages/ProgressLog.tsx</code> · Click any row with a chevron for detail.
        {" "}Recent: Images unified, Box Quantities → Products tab, NGK import (785 SKUs), Stock Count Game, stocktake-sync deployed, filter persistence bug fixed (Stock Valuation/Health/Velocity/Products).
      </p>
    </div>
  );
};

export default ProgressLog;
