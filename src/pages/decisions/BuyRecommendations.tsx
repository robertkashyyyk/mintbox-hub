import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/PageLoader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Search, Truck, Package, PoundSterling, Loader2, FilePlus2, ArrowLeft, ChevronRight, AlertTriangle, Clock, RefreshCw,
  Download, ArrowUpDown, ArrowUp, ArrowDown, TrendingUp,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { bandRecoveryTarget, TIER_OPTIONS, TIER_TARGET_POR_PCT, type Tier } from "@/lib/reprice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useBuyRecommendationsRpc, useBuyRecommendationsSummary, type BuyRecommendationRow,
} from "@/hooks/useBuyRecommendationsRpc";
import { useSentPoSuppression } from "@/hooks/useSentPoSuppression";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { logActivity, LOG_ACTIONS } from "@/lib/activityLog";

const formatGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n || 0);

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

// Profitability tier (from get_sku_profit_tiers). Bands mirror src/lib/reprice.ts.
const TIER_META: Record<string, { label: string; dot: string; rank: number }> = {
  loss:      { label: "Loss",      dot: "bg-red-500",              rank: 0 },
  breakeven: { label: "Breakeven", dot: "bg-orange-500",           rank: 1 },
  poor:      { label: "Poor",      dot: "bg-amber-500",            rank: 2 },
  average:   { label: "Average",   dot: "bg-yellow-400",           rank: 3 },
  good:      { label: "Good",      dot: "bg-lime-500",             rank: 4 },
  great:     { label: "Great",     dot: "bg-green-500",            rank: 5 },
  amazing:   { label: "Amazing",   dot: "bg-emerald-500",          rank: 6 },
  stellar:   { label: "Stellar",   dot: "bg-sky-500",              rank: 7 },
  unknown:   { label: "No recent costed sale", dot: "bg-muted-foreground/30", rank: -1 },
};
interface SkuTier { band: string; por: number | null; n: number; courier: number | null }

const extractPrefix = (sku: string) => {
  if (!sku) return "—";
  const sep = sku.includes("/") ? "/" : "-";
  const head = sku.split(sep)[0];
  return head ? head.toUpperCase() : sku;
};

const brandLabel = (r: BuyRecommendationRow) =>
  r.brand_name || extractPrefix(r.sku);

type RowStatus = "po_sent_pending" | "critical" | "backorder" | "oos" | "low" | "ok";

// Single source of truth for a row's status — used by both the badge and the Status filter
// so they can never drift apart.
const rowStatus = (r: BuyRecommendationRow): RowStatus => {
  if (r.status === "po_sent_pending") return "po_sent_pending";
  const stock = num(r.current_stock);
  const bo = num(r.back_orders);
  const lsa = num(r.low_stock_alert);
  if (bo > 0 && stock < lsa) return "critical";
  if (bo > 0) return "backorder";
  if (stock <= 0) return "oos";
  if (stock < lsa) return "low";
  return "ok";
};

// Status options shown in the detail-view filter (po_sent_pending rows are already excluded upstream).
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "critical", label: "Critical" },
  { value: "backorder", label: "Backorder" },
  { value: "oos", label: "Out of stock" },
  { value: "low", label: "Low stock" },
  { value: "ok", label: "OK" },
];

const statusBadge = (r: BuyRecommendationRow) => {
  switch (rowStatus(r)) {
    case "po_sent_pending":
      return <Badge className="bg-pd-accent text-pd-accent-foreground">PO Sent</Badge>;
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
    case "backorder":
      return <Badge className="bg-warning text-warning-foreground">Backorder</Badge>;
    case "oos":
      return <Badge variant="destructive">Urgent — Out of Stock</Badge>;
    case "low":
      return <Badge variant="secondary">Low Stock</Badge>;
    default:
      return <Badge variant="outline">OK</Badge>;
  }
};

function SortTH({ label, k, sortKey, sortDir, onSort, align, title }: {
  label: string; k: string; sortKey: string | null; sortDir: "asc" | "desc";
  onSort: (k: string) => void; align?: "right"; title?: string;
}) {
  const active = sortKey === k;
  return (
    <TableHead className={`cursor-pointer select-none ${align === "right" ? "text-right" : ""}`} onClick={() => onSort(k)} title={title}>
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        {active ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </span>
    </TableHead>
  );
}

interface SupplierGroup {
  supplierId: string | null;
  supplierName: string;
  rows: BuyRecommendationRow[];
  totalSkus: number;
  totalUnits: number;
  totalSpend: number;
  hasBackorder: boolean;
}

const BuyRecommendations = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useBuyRecommendationsRpc({ includePending: true });
  const { data: summary } = useBuyRecommendationsSummary();
  const { suppressionMap, hours: suppressionHours } = useSentPoSuppression();
  const [refreshing, setRefreshing] = useState(false);

  const refreshStock = async (skus?: string[]) => {
    setRefreshing(true);
    const { data, error } = await supabase.functions.invoke("sync-mintsoft-stock", {
      body: skus && skus.length > 0 ? { skus } : {},
    });
    setRefreshing(false);
    if (error) {
      toast({ title: "Refresh failed", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: "Stock & LSA refreshed from Mintsoft",
        description: `Updated ${(data as any)?.updated ?? 0} SKUs${skus ? ` for this supplier` : ""}.`,
      });
      qc.invalidateQueries({ queryKey: ["buy-recommendations"] });
      qc.invalidateQueries({ queryKey: ["buy-recommendations-summary"] });
    }
  };

  // Mode: null = supplier summary, otherwise the chosen supplierId (or "__unmapped__")
  const [supplierView, setSupplierView] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [boOnly, setBoOnly] = useState(false);
  const [saOnly, setSaOnly] = useState(false);
  const [brandFilter, setBrandFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [summaryBrand, setSummaryBrand] = useState("all");
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseTier, setRaiseTier] = useState<Tier>("good");
  const [raising, setRaising] = useState(false);

  // Active rows = exclude pending suppressed; apply BO/SA toggles and search at page level
  const activeRows = useMemo(
    () => rows.filter((r) => r.status !== "po_sent_pending"),
    [rows]
  );

  // All brands present across the board (for the summary-view brand filter).
  const allBrands = useMemo(
    () => Array.from(new Set(activeRows.map((r) => brandLabel(r)))).sort((a, b) => a.localeCompare(b)),
    [activeRows]
  );

  // Group by supplier for the summary view. A brand filter here narrows which
  // rows feed the groups, so supplier counts/totals reflect just that brand.
  const supplierGroups = useMemo<SupplierGroup[]>(() => {
    const map = new Map<string, SupplierGroup>();
    for (const r of activeRows) {
      if (summaryBrand !== "all" && brandLabel(r) !== summaryBrand) continue;
      const key = r.supplier_id || "__unmapped__";
      const name = r.supplier_name || "Unmapped";
      if (!map.has(key)) {
        map.set(key, {
          supplierId: r.supplier_id,
          supplierName: name,
          rows: [],
          totalSkus: 0,
          totalUnits: 0,
          totalSpend: 0,
          hasBackorder: false,
        });
      }
      const g = map.get(key)!;
      const qty = Math.max(0, Math.round(num(r.required_qty)));
      g.rows.push(r);
      g.totalSkus += 1;
      g.totalUnits += qty;
      g.totalSpend += qty * num(r.unit_cost);
      if (num(r.back_orders) > 0) g.hasBackorder = true;
    }
    return Array.from(map.values()).sort((a, b) => b.totalSpend - a.totalSpend);
  }, [activeRows, summaryBrand]);

  // Filter the summary list itself (by search on supplier name + suppression window)
  const filteredSupplierGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return supplierGroups.filter((g) => {
      if (g.supplierId) {
        const s = suppressionMap.get(g.supplierId);
        if (s?.suppressed) return false; // hide during PO suppression window
      }
      if (q && !g.supplierName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [supplierGroups, search, suppressionMap]);

  // Detail rows for selected supplier
  const detailRows = useMemo(() => {
    if (!supplierView) return [];
    const g = supplierGroups.find(
      (x) => (x.supplierId || "__unmapped__") === supplierView
    );
    if (!g) return [];
    const q = search.trim().toLowerCase();
    return g.rows.filter((r) => {
      if (boOnly && !(Math.max(0, num(r.back_orders) - num(r.on_order)) > 0)) return false;
      if (saOnly && Math.max(0, num(r.back_orders) - num(r.on_order)) > 0) return false;
      if (brandFilter !== "all" && brandLabel(r) !== brandFilter) return false;
      if (statusFilter !== "all" && rowStatus(r) !== statusFilter) return false;
      if (q && !(r.sku.toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [supplierView, supplierGroups, boOnly, saOnly, brandFilter, statusFilter, search]);

  // Distinct brands available in the current supplier's rows (for the Brand filter dropdown).
  const detailBrands = useMemo(() => {
    if (!supplierView) return [];
    const g = supplierGroups.find((x) => (x.supplierId || "__unmapped__") === supplierView);
    if (!g) return [];
    return Array.from(new Set(g.rows.map((r) => brandLabel(r)))).sort((a, b) => a.localeCompare(b));
  }, [supplierView, supplierGroups]);

  const currentSupplier = useMemo(() => {
    if (!supplierView) return null;
    return supplierGroups.find((g) => (g.supplierId || "__unmapped__") === supplierView) || null;
  }, [supplierView, supplierGroups]);

  // Per-SKU "last known" profitability tier (blended POR over recent costed sales).
  const supplierSkus = useMemo(() => currentSupplier?.rows.map((r) => r.sku) ?? [], [currentSupplier]);
  const { data: tierRows = [] } = useQuery({
    queryKey: ["sku-profit-tiers", supplierView, supplierSkus.length],
    enabled: supplierSkus.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_sku_profit_tiers", { p_skus: supplierSkus });
      if (error) throw error;
      return (data ?? []) as { sku: string; blended_por: number | null; band: string; sample_size: number; avg_courier: number | null }[];
    },
  });
  const tierMap = useMemo(() => {
    const m = new Map<string, SkuTier>();
    for (const t of tierRows) m.set(t.sku, { band: t.band, por: t.blended_por, n: t.sample_size, courier: t.avg_courier });
    return m;
  }, [tierRows]);

  type SortKey = "sku" | "product" | "brand" | "status" | "stock" | "lsa" | "bo" | "sales4w" | "onorder" | "qty" | "cost" | "tier";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  // Reset selection when leaving detail or changing supplier
  useEffect(() => {
    setSelected({});
    setOverrides({});
    setSearch("");
    setBoOnly(false);
    setSaOnly(false);
    setBrandFilter("all");
    setStatusFilter("all");
    setSortKey(null);
  }, [supplierView]);

  const selectedRows = useMemo(
    () => detailRows.filter((r) => selected[r.sku]),
    [detailRows, selected]
  );

  const allOnPageSelected = detailRows.length > 0 && detailRows.every((r) => selected[r.sku]);

  const toggleAll = () => {
    if (allOnPageSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      detailRows.forEach((r) => (next[r.sku] = true));
      setSelected(next);
    }
  };

  // Clear manual qty overrides when BO Only is toggled so the new default suggestion takes effect.
  useEffect(() => {
    setOverrides({});
  }, [boOnly]);



  // Default suggested qty per row, respecting BO Only mode (net BO rounded up to box qty).
  const suggestedFor = (r: any) => {
    const full = Math.max(0, Math.round(num(r.required_qty)));
    if (!boOnly) return full;
    const box = Math.max(1, num(r.box_quantity) || 1);
    const netBo = Math.max(0, num(r.back_orders) - num(r.on_order));
    return netBo > 0 ? Math.ceil(netBo / box) * box : 0;
  };

  const selectionSummary = useMemo(() => {
    const units = selectedRows.reduce((a, r) => a + (overrides[r.sku] ?? suggestedFor(r)), 0);
    const cost = selectedRows.reduce(
      (a, r) => a + (overrides[r.sku] ?? suggestedFor(r)) * num(r.unit_cost),
      0
    );
    return { count: selectedRows.length, units, cost };
  }, [selectedRows, overrides, boOnly]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return detailRows;
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: BuyRecommendationRow): number | string => {
      switch (sortKey) {
        case "sku": return r.sku;
        case "product": return r.product_name || "";
        case "brand": return brandLabel(r);
        case "status": return rowStatus(r);
        case "stock": return num(r.current_stock);
        case "lsa": return num(r.low_stock_alert);
        case "bo": return Math.max(0, num(r.back_orders) - num(r.on_order));
        case "sales4w": return num(r.sales_4w);
        case "onorder": return num(r.on_order);
        case "qty": return overrides[r.sku] ?? suggestedFor(r);
        case "cost": return (overrides[r.sku] ?? suggestedFor(r)) * num(r.unit_cost);
        case "tier": return TIER_META[tierMap.get(r.sku)?.band ?? "unknown"].rank;
        default: return 0;
      }
    };
    return [...detailRows].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [detailRows, sortKey, sortDir, overrides, tierMap]);

  const exportCsv = () => {
    const rowsToExport = selectedRows.length ? selectedRows : sortedRows;
    const hdr = ["SKU", "Product", "Brand", "Status", "Stock", "LSA", "BO_net", "Sales4W", "OnOrder", "SuggestQty", "EstCost", "Tier", "POR_pct", "SampleSize"];
    const lines = rowsToExport.map((r) => {
      const qty = overrides[r.sku] ?? suggestedFor(r);
      const t = tierMap.get(r.sku);
      return [
        r.sku, r.product_name ?? "", brandLabel(r), rowStatus(r), num(r.current_stock), num(r.low_stock_alert),
        Math.max(0, num(r.back_orders) - num(r.on_order)), num(r.sales_4w), num(r.on_order), qty,
        (qty * num(r.unit_cost)).toFixed(2), TIER_META[t?.band ?? "unknown"].label, t?.por ?? "", t?.n ?? "",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const blob = new Blob([[hdr.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `buy-recs-${(currentSupplier?.supplierName ?? "supplier").replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // "Raise to tier & re-order" — preview per selected SKU. Target price uses the
  // SKU's OWN average courier (from its recent sales) — never a flat fee. If we
  // have no courier data we can't price it honestly, so target is null → skipped.
  const raisePreview = useMemo(() => selectedRows.map((r) => {
    const t = tierMap.get(r.sku);
    const courier = t?.courier ?? null;
    const target = courier != null ? bandRecoveryTarget({ costUnit: num(r.unit_cost), courierUnit: courier, tier: raiseTier }) : null;
    const box = Math.max(1, num(r.box_quantity) || 1);
    return { sku: r.sku, cost: num(r.unit_cost), courier, target, orderQty: box > 1 ? box : 2, band: t?.band ?? "unknown" };
  }), [selectedRows, raiseTier, tierMap]);

  const raiseActionable = useMemo(() => raisePreview.filter((p) => p.target != null && p.target > 0), [raisePreview]);

  const runRaiseReorder = async () => {
    if (raiseActionable.length === 0) return;
    setRaising(true);
    const sb = supabase as any;
    try {
      // 1. Reprice each to the tier target → the evening eBay reprice queue.
      const pushByStore = new Map<string, { sku: string; new_price: number }[]>();
      let noListing = 0;
      for (const p of raiseActionable) {
        const { data: listings } = await sb.rpc("get_coverage_listings_for_sku", { p_base_sku: p.sku });
        if (!listings?.length) { noListing++; continue; }
        for (const l of listings as any[]) {
          if (!l.store_id) continue;
          if (!pushByStore.has(l.store_id)) pushByStore.set(l.store_id, []);
          pushByStore.get(l.store_id)!.push({ sku: l.listing_sku, new_price: Number(p.target!.toFixed(2)) });
        }
      }
      let repriced = 0;
      for (const [store_id, storeRows] of pushByStore) {
        const { error } = await sb.functions.invoke("threeds-reprice-push", { body: { store_id, rows: storeRows, source: "buy_probation" } });
        if (!error) repriced += storeRows.length;
      }
      // 2. Reset LSA to 2 (Mintsoft + mirror to products_cache, handled by the edge fn).
      const skus = raiseActionable.map((p) => p.sku);
      const { data: products } = await sb.from("products_cache").select("sku, mintsoft_id").in("sku", skus);
      const idMap = new Map((products || []).map((pp: any) => [pp.sku, pp.mintsoft_id]));
      const items = raiseActionable
        .map((p) => ({ sku: p.sku, mintsoft_product_id: idMap.get(p.sku), low_stock_alert_level: 2 }))
        .filter((it) => !!it.mintsoft_product_id);
      let lsaUpdated = 0;
      if (items.length) {
        const { data: lsaRes } = await sb.functions.invoke("mintsoft-update-lsa", { body: { items } });
        lsaUpdated = Number((lsaRes as any)?.updated ?? 0);
      }
      // 3. Set minimal re-order qty + keep selected → ready for Create Draft PO.
      const nextOverrides = { ...overrides };
      for (const p of raiseActionable) nextOverrides[p.sku] = p.orderQty;
      setOverrides(nextOverrides);

      const skippedNoData = raisePreview.length - raiseActionable.length;
      logActivity({ action: LOG_ACTIONS.REPRICE_TRIGGER, entityType: "brand", entityLabel: currentSupplier?.supplierName, detail: { context: "buy_probation", skus: skus.length, tier: raiseTier, repriced, lsa_reset: lsaUpdated, no_listing: noListing, skipped_no_data: skippedNoData } });
      toast({
        title: "Repriced, LSA reset — ready to re-order",
        description: `${repriced} listing price(s) queued to ${raiseTier}, LSA→2 on ${lsaUpdated} SKU(s)${noListing ? `, ${noListing} had no eBay listing` : ""}${skippedNoData ? `, ${skippedNoData} skipped (no courier data)` : ""}. Review qty and Create Draft PO.`,
      });
      setRaiseOpen(false);
      qc.invalidateQueries({ queryKey: ["buy-recommendations"] });
      qc.invalidateQueries({ queryKey: ["sku-profit-tiers"] });
    } catch (e: any) {
      toast({ title: "Raise & re-order failed", description: e.message, variant: "destructive" });
    } finally {
      setRaising(false);
    }
  };

  const pendingCount = rows.filter((r) => r.status === "po_sent_pending").length;

  const summaryStats = useMemo(() => {
    const totalUnits = supplierGroups.reduce((a, g) => a + g.totalUnits, 0);
    const totalSpend = supplierGroups.reduce((a, g) => a + g.totalSpend, 0);
    const totalSkus = supplierGroups.reduce((a, g) => a + g.totalSkus, 0);
    return { suppliers: supplierGroups.length, totalSkus, totalUnits, totalSpend };
  }, [supplierGroups]);

  const createDraftPo = async () => {
    if (!currentSupplier || selectedRows.length === 0) return;
    if (!currentSupplier.supplierId) {
      toast({
        title: "Unmapped supplier",
        description: "Map these SKUs to a supplier in Suppliers admin before creating a PO.",
        variant: "destructive",
      });
      return;
    }
    setCreating(true);
    const sb = supabase as any;
    try {
      const totalUnits = selectedRows.reduce(
        (a, r) => a + (overrides[r.sku] ?? suggestedFor(r)),
        0
      );
      const totalCost = selectedRows.reduce(
        (a, r) => a + (overrides[r.sku] ?? suggestedFor(r)) * num(r.unit_cost),
        0
      );
      const { data: po, error: poErr } = await sb
        .from("purchase_orders")
        .insert({
          supplier_id: currentSupplier.supplierId,
          status: "draft",
          po_number: `PO-${Date.now()}-${currentSupplier.supplierName.slice(0, 3).toUpperCase()}`,
          total_qty: totalUnits,
          total_cost: totalCost,
        })
        .select("id")
        .single();
      if (poErr) throw poErr;

      const lines = selectedRows
        .map((r) => ({
          po_id: po.id,
          sku: r.sku,
          product_name: r.product_name,
          qty_ordered: overrides[r.sku] ?? suggestedFor(r),
          unit_cost: num(r.unit_cost),
          snapshot_live_stock: num(r.current_stock),
          snapshot_on_order: num(r.on_order),
          snapshot_back_orders: num(r.back_orders),
          snapshot_low_stock_alert: num(r.low_stock_alert),
        }))
        .filter((l) => l.qty_ordered > 0);

      if (lines.length === 0) {
        toast({ title: "Nothing to order", description: "All selected lines had qty 0.", variant: "destructive" });
        return;
      }

      const { error: linesErr } = await sb.from("purchase_order_lines").insert(lines);
      if (linesErr) throw linesErr;

      logActivity({ action: LOG_ACTIONS.PO_CREATE, entityType: "purchase_order", entityId: po.id, entityLabel: po.id, detail: { supplier: currentSupplier.supplierName, lines: lines.length, total_qty: totalUnits, total_cost: totalCost } });
      toast({
        title: "Draft PO created",
        description: `${lines.length} lines for ${currentSupplier.supplierName}.`,
      });
      navigate(`/execution/purchase-orders/${po.id}`);
    } catch (e: any) {
      toast({ title: "Could not create PO", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  // ============ SUPPLIER SUMMARY VIEW ============
  if (!supplierView) {
    return (
      <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Buy Recommendations</h1>
            <p className="text-foreground/60">Pick a supplier to review SKUs and create a draft PO.</p>
          </div>
          {pendingCount > 0 && (
            <Badge className="bg-pd-accent text-pd-accent-foreground">
              {pendingCount} SKU{pendingCount === 1 ? "" : "s"} suppressed (PO sent)
            </Badge>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Suppliers to order from</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" /></CardHeader>
            <CardContent><div className="text-2xl font-bold">{summaryStats.suppliers}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total SKUs</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" /></CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summaryStats.totalSkus.toLocaleString()}</div>
              {summary && Number(summary.recommended_count) !== summaryStats.totalSkus && (
                <p className="text-xs text-muted-foreground">summary: {Number(summary.recommended_count).toLocaleString()}</p>
              )}
            </CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total units</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" /></CardHeader>
            <CardContent><div className="text-2xl font-bold">{summaryStats.totalUnits.toLocaleString()}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Estimated spend</CardTitle>
            <PoundSterling className="h-4 w-4 text-muted-foreground" /></CardHeader>
            <CardContent><div className="text-2xl font-bold">{formatGBP(summaryStats.totalSpend)}</div></CardContent></Card>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative flex-1 min-w-[240px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search supplier name..." value={search}
                  onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Brand</Label>
                <Select value={summaryBrand} onValueChange={setSummaryBrand}>
                  <SelectTrigger className="h-9 w-[180px]" aria-label="Filter by brand">
                    <SelectValue placeholder="All brands" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All brands</SelectItem>
                    {allBrands.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {summaryBrand !== "all" && (
                <Button variant="ghost" size="sm" onClick={() => setSummaryBrand("all")} className="text-xs">
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <PageLoader rows={8} columns={[120, 220, 80, 80, 80, 80, 100]} label="Loading recommendations" />
        ) : filteredSupplierGroups.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            No suppliers have SKUs that need ordering right now.
          </CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">SKUs to order</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Estimated spend</TableHead>
                      <TableHead>Flags</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSupplierGroups.map((g) => {
                      const key = g.supplierId || "__unmapped__";
                      const unmapped = !g.supplierId;
                      const overdue = g.supplierId ? suppressionMap.get(g.supplierId)?.overdueNoAsn : false;
                      return (
                        <TableRow
                          key={key}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setSupplierView(key)}
                        >
                          <TableCell className="font-medium">
                            {unmapped ? (
                              <span className="text-destructive">Unmapped SKUs</span>
                            ) : (
                              g.supplierName
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{g.totalSkus.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">{g.totalUnits.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatGBP(g.totalSpend)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {g.hasBackorder && <Badge className="bg-warning text-warning-foreground">BO</Badge>}
                              {unmapped && <Badge variant="destructive">No supplier</Badge>}
                              {overdue && (
                                <Badge variant="destructive" className="gap-1">
                                  <Clock className="h-3 w-3" /> PO Pending — No ASN Yet
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ============ SUPPLIER DETAIL VIEW ============
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" onClick={() => setSupplierView(null)} className="text-pd-accent -ml-2">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to suppliers
          </Button>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {currentSupplier?.supplierName || "Supplier"}
          </h1>
          <p className="text-foreground/60">
            {currentSupplier?.totalSkus} SKUs to order • estimated spend {formatGBP(currentSupplier?.totalSpend || 0)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectionSummary.count > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectionSummary.count} selected • {selectionSummary.units.toLocaleString()} units • {formatGBP(selectionSummary.cost)}
            </span>
          )}
          <Button
            variant="outlineDark"
            size="sm"
            onClick={exportCsv}
            disabled={detailRows.length === 0}
            title={selectedRows.length ? `Export ${selectedRows.length} selected rows to CSV` : "Export all shown rows to CSV"}
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV{selectedRows.length ? ` (${selectedRows.length})` : ""}
          </Button>
          <Button
            variant="outlineDark"
            size="sm"
            onClick={() => refreshStock(currentSupplier?.rows.map((r) => r.sku) || [])}
            disabled={refreshing || !currentSupplier}
            title="Pull live stock AND low-stock-alert (LSA) levels from Mintsoft for this supplier's SKUs, then recompute the recommendations"
          >
            {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh stock & LSA
          </Button>
          {selectionSummary.count > 0 && (
            <Button
              variant="outlineDark"
              size="sm"
              onClick={() => setRaiseOpen(true)}
              title="Reprice each to a target profit tier (evening eBay push), reset LSA to 2, and set a minimal re-order qty — so the item proves itself at the right price"
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Raise &amp; re-order ({selectionSummary.count})
            </Button>
          )}
          <Button
            disabled={creating || selectionSummary.count === 0 || !currentSupplier?.supplierId}
            onClick={createDraftPo}
          >
            {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FilePlus2 className="h-4 w-4 mr-2" />}
            Create Draft PO
          </Button>
        </div>
      </div>

      {(() => {
        const sup = currentSupplier?.supplierId ? suppressionMap.get(currentSupplier.supplierId) : null;
        if (!sup) return null;
        const sentLabel = new Date(sup.sentAt).toLocaleString("en-GB", {
          day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
        });
        if (sup.suppressed) {
          return (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>PO sent to Mintsoft on {sentLabel}</strong> — awaiting ASN conversion.
                Supplier is suppressed from the summary list for {suppressionHours}h and will reappear automatically
                if stock levels change after the next sync.
                {sup.poNumber && <> · <Link to={`/execution/purchase-orders/${sup.poId}`} className="underline">View PO {sup.poNumber}</Link></>}
              </AlertDescription>
            </Alert>
          );
        }
        if (sup.overdueNoAsn) {
          return (
            <Alert variant="destructive">
              <Clock className="h-4 w-4" />
              <AlertDescription>
                <strong>PO Pending — No ASN Yet.</strong> Sent to Mintsoft on {sentLabel} and not yet converted to an ASN
                (window of {suppressionHours}h has elapsed). Chase Mintsoft rather than re-ordering.
                {sup.poNumber && <> · <Link to={`/execution/purchase-orders/${sup.poId}`} className="underline">View PO {sup.poNumber}</Link></>}
              </AlertDescription>
            </Alert>
          );
        }
        return null;
      })()}

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search SKU or product name..." value={search}
                onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="bo-only" checked={boOnly} onCheckedChange={(v) => { setBoOnly(v); if (v) setSaOnly(false); }} />
              <Label htmlFor="bo-only" className="cursor-pointer text-sm">BO Only</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="sa-only" checked={saOnly} onCheckedChange={(v) => { setSaOnly(v); if (v) setBoOnly(false); }} />
              <Label htmlFor="sa-only" className="cursor-pointer text-sm">SA Only</Label>
            </div>
            {detailBrands.length > 1 && (
              <Select value={brandFilter} onValueChange={setBrandFilter}>
                <SelectTrigger className="h-9 w-[160px]" aria-label="Filter by brand">
                  <SelectValue placeholder="All brands" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All brands</SelectItem>
                  {detailBrands.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[150px]" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(brandFilter !== "all" || statusFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setBrandFilter("all"); setStatusFilter("all"); }}
                className="text-xs"
              >
                Clear
              </Button>
            )}
            <div className="ml-auto text-xs text-muted-foreground">
              Showing {detailRows.length.toLocaleString()} of {currentSupplier?.totalSkus || 0}
            </div>
          </div>
        </CardContent>
      </Card>

      {detailRows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          No SKUs match the current filters.
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-card">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allOnPageSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                    </TableHead>
                    <SortTH label="SKU" k="sku" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} />
                    <SortTH label="Product" k="product" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} />
                    <SortTH label="Brand" k="brand" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} />
                    <SortTH label="Margin" k="tier" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} title="Last-known profit tier — blended POR over recent costed sales, all channels" />
                    <SortTH label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} />
                    <SortTH label="Stock" k="stock" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} align="right" />
                    <SortTH label="LSA" k="lsa" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} align="right" />
                    <SortTH label="BO" k="bo" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} align="right" />
                    <SortTH label="Sales 4W" k="sales4w" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} align="right" title="Units sold in last 28 days" />
                    <SortTH label="On Order" k="onorder" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} align="right" />
                    <SortTH label="Suggest Qty" k="qty" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} align="right" />
                    <SortTH label="Est. Cost" k="cost" sortKey={sortKey} sortDir={sortDir} onSort={(k) => toggleSort(k as any)} align="right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                   {sortedRows.map((r) => {
                    const fullSuggested = Math.max(0, Math.round(num(r.required_qty)));
                    const raw = Math.max(0, Math.round(num(r.raw_required_qty)));
                    const box = Math.max(1, num(r.box_quantity) || 1);
                    // In BO Only mode, suggest just the net backorder (BO − on order), rounded up to box qty.
                    const netBo = Math.max(0, num(r.back_orders) - num(r.on_order));
                    const boSuggested = netBo > 0 ? Math.ceil(netBo / box) * box : 0;
                    const suggested = boOnly ? boSuggested : fullSuggested;
                    const qty = overrides[r.sku] ?? suggested;
                    const lineCost = qty * num(r.unit_cost);
                    const wasBoxed = box > 1 && suggested > raw && raw > 0 && !boOnly;
                    return (
                      <TableRow key={r.sku} data-state={selected[r.sku] ? "selected" : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={!!selected[r.sku]}
                            onCheckedChange={(v) => setSelected({ ...selected, [r.sku]: !!v })}
                            aria-label={`Select ${r.sku}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Link to={`/discovery/products/${r.sku}`} className="text-primary hover:underline font-mono text-xs">
                            {r.sku}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{r.product_name || "—"}</TableCell>
                        <TableCell className="text-sm">
                          {r.brand_name ? r.brand_name : (
                            <span className="text-muted-foreground" title="No brand mapping — falling back to SKU prefix">
                              {brandLabel(r)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const t = tierMap.get(r.sku);
                            const meta = TIER_META[t?.band ?? "unknown"];
                            const tip = t && t.por != null
                              ? `${meta.label} · ${t.por}% POR over last ${t.n} sale${t.n === 1 ? "" : "s"}`
                              : "No recent costed sale";
                            return (
                              <span className="inline-flex items-center justify-center" title={tip}>
                                <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell>{statusBadge(r)}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(r.current_stock)}</TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">{num(r.low_stock_alert)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {(() => {
                            const bo = num(r.back_orders);
                            const oo = num(r.on_order);
                            const net = Math.max(0, bo - oo);
                            if (bo <= 0) return <span className="text-muted-foreground">0</span>;
                            if (oo > 0) {
                              return (
                                <span
                                  className={net > 0 ? "text-warning font-medium" : "text-muted-foreground"}
                                  title={`${bo} on backorder − ${oo} on order = net ${net}`}
                                >
                                  {net}
                                  <span className="ml-1 text-[10px] text-muted-foreground">({bo}-{oo})</span>
                                </span>
                              );
                            }
                            return <span className="text-warning font-medium">{bo}</span>;
                          })()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {num(r.sales_4w) > 0 ? num(r.sales_4w) : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">{num(r.on_order)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <Input
                              type="number"
                              min={0}
                              value={qty}
                              onChange={(e) => setOverrides({
                                ...overrides,
                                [r.sku]: Math.max(0, parseInt(e.target.value, 10) || 0),
                              })}
                              className={`h-8 w-20 text-right tabular-nums ${wasBoxed ? "border-pd-accent" : ""}`}
                            />
                            {wasBoxed && (
                              <span className="text-[10px] text-pd-accent" title={`Rounded up to box of ${box} (needed ${raw})`}>
                                box of {box} · needed {raw}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatGBP(lineCost)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={raiseOpen} onOpenChange={(o) => !raising && setRaiseOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Raise price &amp; re-order — {raisePreview.length} SKU{raisePreview.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              Reprice each to the target tier (queued to the evening eBay push), reset LSA to 2, and set a minimal re-order qty so it can prove itself at the right price. Amazon repricing to follow. All reversible via the repricer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Target tier</Label>
              <Select value={raiseTier} onValueChange={(v) => setRaiseTier(v as Tier)}>
                <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIER_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label} (~{TIER_TARGET_POR_PCT[t.value]}% POR)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border border-border/60 max-h-64 overflow-y-auto text-xs">
              <table className="w-full">
                <thead className="sticky top-0 bg-card text-muted-foreground">
                  <tr>
                    <th className="text-left p-2">SKU</th><th className="text-right p-2">Cost</th><th className="text-right p-2">Courier</th>
                    <th className="text-right p-2">Now</th><th className="text-right p-2">→ Target price</th><th className="text-right p-2">Order</th>
                  </tr>
                </thead>
                <tbody>
                  {raisePreview.map((p) => (
                    <tr key={p.sku} className={`border-t border-border/40 ${p.target == null ? "opacity-50" : ""}`}>
                      <td className="p-2 font-mono">
                        <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${TIER_META[p.band].dot}`} />{p.sku}
                      </td>
                      <td className="p-2 text-right">{formatGBP(p.cost)}</td>
                      <td className="p-2 text-right text-muted-foreground">{p.courier != null ? `£${p.courier.toFixed(2)}` : "—"}</td>
                      <td className="p-2 text-right text-muted-foreground">{TIER_META[p.band].label}</td>
                      <td className="p-2 text-right font-semibold text-emerald-400">
                        {p.target != null ? `£${p.target.toFixed(2)}` : <span className="text-muted-foreground font-normal" title="No courier data from recent sales — skipped rather than guess a fee">— no data</span>}
                      </td>
                      <td className="p-2 text-right tabular-nums">{p.target != null ? p.orderQty : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Target price uses each SKU's <strong>own</strong> average courier from recent sales — never a flat fee; SKUs with no courier data are skipped. Prices queue to the evening SFTP push. LSA resets to 2 now (pushed to Mintsoft) so velocity rebuilds from real sales at the healthy price. Then review quantities and hit <strong>Create Draft PO</strong>.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRaiseOpen(false)} disabled={raising}>Cancel</Button>
            <Button onClick={runRaiseReorder} disabled={raising || raiseActionable.length === 0}>
              {raising ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <TrendingUp className="h-4 w-4 mr-2" />}
              Raise {raiseActionable.length} to {TIER_OPTIONS.find((t) => t.value === raiseTier)?.label} &amp; set re-order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BuyRecommendations;
