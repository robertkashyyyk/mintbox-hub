/**
 * ProgressLog — living record of what's built, what's in progress,
 * what's planned (hidden stubs), and what decisions are still open.
 *
 * This is a static/hardcoded page maintained by the dev team.
 * No database required — it's a project management artefact.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import ModuleHeader from "@/components/ModuleHeader";
import {
  CheckCircle2, Circle, Clock, AlertCircle, XCircle,
  HelpCircle, ClipboardList,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type Status = "live" | "in-progress" | "planned" | "decision-needed" | "retired";

interface LogItem {
  name: string;
  route?: string;
  notes: string;
  status: Status;
  section?: string;
}

// ── Data ─────────────────────────────────────────────────────────────────────

const ITEMS: LogItem[] = [

  // ── DISCOVERY ──────────────────────────────────────────────────────────────
  { section: "Discovery", name: "Products", route: "/discovery/products", status: "live", notes: "SKU database — search, filter, detail view. Solid." },
  { section: "Discovery", name: "Brands", route: "/discovery/brands", status: "live", notes: "Brand list with multipliers, prefix rules, SKU counts. Solid." },
  { section: "Discovery", name: "Discovery Queue", route: "/discovery/discovery-queue", status: "live", notes: "New SKUs from orders awaiting enrichment. Solid." },
  { section: "Discovery", name: "Feed Imports", route: "/discovery/feed-imports", status: "retired", notes: "Old one-shot data seeding tool. No longer used. Removed from nav. Route still exists." },
  { section: "Discovery", name: "Supplier Feeds", route: undefined, status: "planned", notes: "Major upcoming build. Live supplier price/stock feeds — underpins purchase ordering, pricing, stock health. Remote Stock Updates is part of this concept." },
  { section: "Discovery", name: "Images", route: undefined, status: "planned", notes: "Consolidate Bulk Image Upload + Pending Images + AI image finding (rebuilt Image Scout concept) into one unified Images area." },
  { section: "Discovery", name: "Bulk Image Upload", route: "/discovery/bulk-images", status: "live", notes: "Works. Needs a pass — should handle supplier batches and AI agent outputs cleanly." },
  { section: "Discovery", name: "Pending Images", route: "/discovery/pending-images", status: "decision-needed", notes: "Probably merges into the future Images area. Currently standalone." },
  { section: "Discovery", name: "Box Quantities", route: "/discovery/box-quantities", status: "decision-needed", notes: "Belongs inside Products (informs purchase ordering logic) rather than a standalone nav item. No nav entry currently." },
  { section: "Discovery", name: "Image Scout ×4", route: "/discovery/image-scout", status: "retired", notes: "Built but wrong approach. AI image finding concept is right — needs full rebuild as part of unified Images area. Routes still exist." },

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
  { section: "Decisions", name: "3D Reprice", route: "/decisions/threeds-reprice", status: "in-progress", notes: "Triggers repricing runs via 3D Sellers. Being actively built." },
  { section: "Decisions", name: "Liquidation Candidates", route: "/decisions/liquidation", status: "planned", notes: "Products recommended for clearance or fire sale. Stub hidden from nav. Route preserved." },
  { section: "Decisions", name: "Price Moves", route: "/decisions/price-moves", status: "planned", notes: "Suggested pricing adjustments. Stub hidden from nav. Route preserved." },
  { section: "Decisions", name: "Bundle Suggestions", route: "/decisions/bundles", status: "planned", notes: "Product bundling opportunities. Stub hidden from nav. Route preserved." },
  { section: "Decisions", name: "Price Hunter", route: "/execution/price-hunter", status: "planned", notes: "eBay price checks and automated pricing. Not ready. Hidden from nav." },
  { section: "Decisions", name: "Listing Cloner", route: "/execution/listing-cloner", status: "planned", notes: "eBay listing templates. Not ready. Hidden from nav." },

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

  // ── DECISIONS OPEN ─────────────────────────────────────────────────────────
  { section: "Open Decisions", name: "Supplier Feeds architecture", status: "decision-needed", notes: "Where does Feeds live? Its own top-level section, or under Discovery? Remote Stock Updates needs to fold into it. Underpins PO, pricing and stock health." },
  { section: "Open Decisions", name: "Images consolidation", status: "decision-needed", notes: "Bulk Upload + Pending Images + AI image finding. Build as one unified area under Discovery?" },
  { section: "Open Decisions", name: "Box Quantities placement", status: "decision-needed", notes: "Move into Products as a tab or sub-feature rather than standalone nav item?" },
  { section: "Open Decisions", name: "Missing Costs / Dirt SKUs in Intelligence nav", status: "decision-needed", notes: "These are data quality issues, not analysis. Should they move to Housekeeping-only in nav, or stay in Intelligence too?" },
  { section: "Open Decisions", name: "Dashboards accuracy review", status: "decision-needed", notes: "All four original dashboards need a pass for data accuracy and usefulness." },
  { section: "Open Decisions", name: "Listing Cloner long-term home", status: "decision-needed", notes: "Doesn't fit cleanly in Decisions (it's a utility). Admin? Discovery? Standalone?" },
];

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<Status, { label: string; color: string; icon: React.ElementType }> = {
  "live":             { label: "Live",           color: "bg-green-500/15 text-green-600 border-green-500/30",   icon: CheckCircle2 },
  "in-progress":      { label: "In Progress",    color: "bg-blue-500/15 text-blue-500 border-blue-500/30",     icon: Clock },
  "planned":          { label: "Planned",        color: "bg-amber-500/15 text-amber-500 border-amber-500/30",  icon: Circle },
  "decision-needed":  { label: "Decision Needed",color: "bg-purple-500/15 text-purple-500 border-purple-500/30", icon: HelpCircle },
  "retired":          { label: "Retired",        color: "bg-muted/40 text-muted-foreground border-border",     icon: XCircle },
};

const SECTION_ORDER = ["Discovery", "Intelligence", "Decisions", "Operations", "Dashboards", "Housekeeping", "Open Decisions"];

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

// ── Component ─────────────────────────────────────────────────────────────────

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
                <div key={item.name}>
                  <div className="flex items-start justify-between gap-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{item.name}</span>
                        {item.route && (
                          <span className="text-xs text-muted-foreground font-mono">{item.route}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.notes}</p>
                    </div>
                    <div className="flex-shrink-0">
                      <StatusBadge status={item.status} />
                    </div>
                  </div>
                  {idx < items.length - 1 && <Separator className="opacity-40" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground pb-4">
        Last updated: June 2026 · This page is maintained manually in <code className="font-mono">src/pages/ProgressLog.tsx</code>
      </p>
    </div>
  );
};

export default ProgressLog;
