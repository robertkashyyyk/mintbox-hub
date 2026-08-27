// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for app navigation.
//
// Both the sidebar (src/components/AppSidebar.tsx) AND the section index card
// grids (src/pages/*Index.tsx) render from this one list. Add a feature HERE and
// it shows up in both places automatically — no more nav/card drift.
//
// Each item: title, url, icon, description (shown on the index cards), and an
// optional superOnly flag. Group-level requireSenior / requireSuper gate the whole
// section. Keep `url` exactly matching the <Route> in src/App.tsx.
//
// NOTE: the RBAC sidebar (RbacSidebar.tsx, driven by the menu_for_user DB view) is
// a separate, currently-dormant system and does not read from this file.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Database, Tag, AlertCircle, Images, Globe, RefreshCw, FileText, Sparkles, PackagePlus,
  LayoutDashboard, DollarSign, FileBarChart2, TrendingUp, Activity, PoundSterling, Truck,
  Calendar, AlertTriangle, Link2Off, HelpCircle, ShoppingBag, ShoppingCart, Gauge, Plug,
  Flame, Package, TrendingDown, Users, Key, CreditCard, Settings, Sliders, ArrowUpDown, Copy, EyeOff, ListChecks,
} from "lucide-react";

export interface NavItem {
  title: string;
  url: string;
  icon: React.ElementType;
  description?: string;
  superOnly?: boolean;
}

export interface NavGroup {
  label: string;
  basePath: string;
  icon: React.ElementType;
  requireSenior?: boolean;
  requireSuper?: boolean;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Discovery",
    basePath: "/discovery",
    icon: Database,
    items: [
      { title: "Products", url: "/discovery/products", icon: Database, description: "Browse and manage your product database" },
      { title: "Brands", url: "/discovery/brands", icon: Tag, description: "Manage brand information and settings" },
      { title: "Discovery Queue", url: "/discovery/discovery-queue", icon: AlertCircle, description: "Products discovered from orders that need enrichment" },
      { title: "Images", url: "/discovery/images", icon: Images, description: "Browse, match and manage product images" },
      { title: "Image Scout", url: "/discovery/image-scout", icon: Sparkles, description: "Agent finds, processes, and stores product images for SKUs missing them" },
      { title: "Web Searcher", url: "/discovery/web-searcher", icon: Globe, description: "Search the web to enrich product data" },
      { title: "Supplier Feeds", url: "/discovery/supplier-feeds", icon: RefreshCw, description: "Configure and sync supplier stock/price feeds" },
      { title: "Feed Imports", url: "/discovery/feed-imports", icon: FileText, description: "Upload product data and configure import rules" },
      { title: "Box Quantities", url: "/discovery/box-quantities", icon: PackagePlus, description: "Minimum order multiples — purchases auto-round up to nearest box" },
    ],
  },
  {
    label: "Intelligence",
    basePath: "/intelligence",
    icon: TrendingUp,
    items: [
      { title: "Scorecard", url: "/intelligence/scorecard", icon: LayoutDashboard, description: "RAG + trend across contribution, 80/20, valuation and data quality — with Orin's narrative." },
      { title: "Contribution Intelligence", url: "/intelligence/profit", icon: DollarSign, description: "Weekly revenue, costs, channel fees and POR." },
      { title: "Standing Reports", url: "/intelligence/standing-reports", icon: FileBarChart2, description: "Recurring reports — e.g. repricing payoff, tracked over time." },
      { title: "Velocity & Coverage", url: "/intelligence/velocity", icon: TrendingUp, description: "Sales velocity and inventory coverage analysis" },
      { title: "Stock Health", url: "/intelligence/stock-health", icon: Activity, description: "Stock levels, overstock, and shortage analysis" },
      { title: "Stock Valuation", url: "/intelligence/stock-valuation", icon: PoundSterling, description: "Cost × on-hand by SKU, brand and health category." },
      { title: "Courier Margin", url: "/intelligence/courier-margin", icon: Truck, description: "Courier cost vs charged margin analysis" },
      { title: "Pricing Signals", url: "/intelligence/pricing", icon: DollarSign, description: "Market pricing trends and competitor intelligence" },
      { title: "Seasonality", url: "/intelligence/seasonality", icon: Calendar, description: "Seasonal demand patterns and forecasts" },
    ],
  },
  {
    label: "Housekeeping",
    basePath: "/housekeeping",
    icon: AlertCircle,
    items: [
      { title: "Missing Costs", url: "/intelligence/missing-costs", icon: AlertCircle, description: "Active SKUs without a cost price set — blocks profit calculation." },
      { title: "Dirt SKUs", url: "/intelligence/dirt-skus", icon: AlertTriangle, description: "SKUs sold recently that don't match any brand prefix style." },
      { title: "Dirt SKUs on eBay", url: "/housekeeping/dirt-listings", icon: AlertTriangle, description: "Live eBay listings with an old dirt label mapped to a true SKU — needs updating at source." },
      { title: "Product Completeness", url: "/housekeeping/missing-barcodes", icon: Tag, description: "Active products missing a barcode, dimensions or weight — fill the gaps and push to Mintsoft." },
      { title: "Carrier Remeasure", url: "/operations/carriers/remeasure", icon: Truck, description: "Items flagged by carriers as wrong dimensions/weight." },
      { title: "Orphan SKUs", url: "/housekeeping/orphan-skus", icon: Link2Off, description: "Catalogue SKUs not linked to a Mintsoft Product ID — blocks cost/stock/LSA pushes." },
      { title: "Amazon SKUs to map", url: "/housekeeping/amazon-sku-mapping", icon: Link2Off, description: "Amazon ASINs that sold recently but don't resolve to a catalogue SKU — map them to recover FBA replenishment + margin." },
      { title: "LSA Unmatched SKUs", url: "/housekeeping/lsa-unmatched", icon: HelpCircle, description: "SKUs in Mintsoft's Low Stock Alert file that don't exist in our cache yet." },
    ],
  },
  {
    label: "Decisions",
    basePath: "/decisions",
    icon: ShoppingBag,
    requireSenior: true,
    items: [
      { title: "Buy Recommendations", url: "/decisions/buying", icon: ShoppingBag, description: "AI-driven purchase order suggestions based on velocity" },
      { title: "FBA Replenishment", url: "/decisions/fba-replenishment", icon: Truck, description: "What to ship into Amazon FBA — demand vs current FBA stock, MOQ-rounded reorder quantities." },
      { title: "FBA Blow-Out", url: "/decisions/fba-blowout", icon: Flame, description: "Stock stuck in FBA (underwater vs the Buy Box) — blow it out to £0.01 to clear, and flag it never-FBA." },
      { title: "Purchase Orders", url: "/execution/purchase-orders", icon: ShoppingCart, description: "Create and manage purchase orders for suppliers" },
      { title: "LSA Calibration", url: "/decisions/lsa-calibration", icon: Gauge, description: "Review and adjust listing strategy advisor settings" },
      { title: "Reprice", url: "/decisions/threeds-reprice", icon: Plug, description: "Reprice eBay/3D via SFTP, or monitor the autonomous Amazon (eSagu) repricer" },
      { title: "Clearance", url: "/decisions/liquidation", icon: Flame, description: "Put dead stock on a timed Sale or Liquidate it — ring-fenced from the repricer" },
      { title: "Opportunities", url: "/decisions/coverage", icon: EyeOff, description: "In stock but not listed on eBay — list them to unlock sales (Clearance diverts unlisted SKUs here)" },
      { title: "Listing Queue", url: "/decisions/listing-queue", icon: ListChecks, description: "SKUs queued for listing — generate each store's 3D GTC import file" },
    ],
  },
  {
    label: "Execution",
    basePath: "/execution",
    icon: ShoppingCart,
    requireSenior: true,
    items: [
      { title: "Purchase Orders", url: "/execution/purchase-orders", icon: ShoppingCart, description: "Create and manage purchase orders for suppliers" },
      { title: "Price Hunter", url: "/execution/price-hunter", icon: DollarSign, description: "eBay price checks and automated pricing updates" },
      { title: "Remote Stock Updates", url: "/execution/remote-stock-updates", icon: RefreshCw, description: "Configure and manage remote stock feed types" },
      { title: "Listing Cloner", url: "/execution/listing-cloner", icon: Copy, description: "Create and manage eBay listings from templates" },
    ],
  },
  {
    label: "Operations",
    basePath: "/operations",
    icon: Activity,
    requireSenior: true,
    items: [
      { title: "Order Telemetry", url: "/operations/order-telemetry", icon: Activity, superOnly: true, description: "Order issue detection, problem tracking and operational actions" },
      { title: "Carriers", url: "/operations/carriers", icon: Truck, description: "Royal Mail / courier penalties — invoices, trends, and packer remeasure queue" },
      { title: "SKU Analysis", url: "/operations/sku-analysis", icon: Package, description: "Top problem SKUs, backorder concentration, brand breakdown" },
      { title: "Despatch KPIs", url: "/operations/despatch-kpis", icon: Truck, description: "Despatch throughput and SLA KPIs" },
      { title: "eBay Performance", url: "/operations/ebay-performance", icon: ShoppingBag, description: "eBay account and listing performance metrics" },
      { title: "Reports", url: "/operations/reports", icon: FileText, superOnly: true, description: "Weekly ops reports and subscriber management" },
    ],
  },
  {
    label: "Dashboards",
    basePath: "/dashboards",
    icon: LayoutDashboard,
    requireSenior: true,
    items: [
      { title: "Operations Dashboard", url: "/operations/dashboard", icon: Activity, description: "Live operational control panel — orders in, despatched, backlog and KPIs." },
      { title: "Warehouse Performance", url: "/dashboards/warehouse", icon: LayoutDashboard, description: "Real-time overview of warehouse operations. Ideal for wall-mounted displays." },
      { title: "Packing Area Display", url: "/dashboards/packing", icon: Package, description: "Focused metrics for packing stations. Track pack rates and queue depth." },
      { title: "Weekly Summary", url: "/dashboards/weekly", icon: TrendingUp, description: "Week-over-week performance trends and daily comparisons." },
      { title: "Trends", url: "/operations/trends", icon: TrendingUp, description: "Historical performance analysis — daily, weekly and rolling averages." },
      { title: "Back Orders", url: "/dashboards/backorders", icon: TrendingDown, description: "Average back-order volume over time with configurable zoom, period, and projected trajectory." },
    ],
  },
  {
    label: "Administration",
    basePath: "/admin",
    icon: Users,
    requireSuper: true,
    items: [
      { title: "User Management", url: "/admin/users", icon: Users, description: "Manage users, roles, and invitations" },
      { title: "API Access", url: "/admin/api-keys", icon: Key, description: "Manage API keys and integrations" },
      { title: "Billing & Usage", url: "/admin/billing", icon: CreditCard, description: "View Xask usage and billing information" },
      { title: "Logs / Diagnostics", url: "/admin/logs", icon: FileText, description: "System logs and diagnostic information" },
      { title: "System Settings", url: "/admin/settings", icon: Settings, description: "Application-wide configuration and feature flags" },
      { title: "Integrations", url: "/admin/integrations", icon: Plug, description: "Manage connections to external services" },
      { title: "Contribution Rules", url: "/admin/profit-rules", icon: Sliders, description: "Configure contribution / fee calculation rules" },
      { title: "Suppliers", url: "/admin/suppliers", icon: Truck, description: "Manage supplier records" },
      { title: "SKU Transformations", url: "/admin/sku-transformations", icon: ArrowUpDown, description: "Configure SKU normalisation / transformation rules" },
      { title: "eBay Categories", url: "/admin/ebay-categories", icon: Tag, description: "Map internal product categories to eBay category IDs for listing creation" },
    ],
  },
];

// Convenience lookup for index pages: getNavGroup("Discovery").items
export const getNavGroup = (label: string): NavGroup | undefined =>
  NAV_GROUPS.find((g) => g.label === label);
