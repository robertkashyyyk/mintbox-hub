import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
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
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);

  // Active rows = exclude pending suppressed; apply BO/SA toggles and search at page level
  const activeRows = useMemo(
    () => rows.filter((r) => r.status !== "po_sent_pending"),
    [rows]
  );

  // Group by supplier for the summary view (pre-search/filter so totals are stable)
  const supplierGroups = useMemo<SupplierGroup[]>(() => {
    const map = new Map<string, SupplierGroup>();
    for (const r of activeRows) {
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
  }, [activeRows]);

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
      if (saOnly && !(num(r.current_stock) < num(r.low_stock_alert))) return false;
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

  // Reset selection when leaving detail or changing supplier
  useEffect(() => {
    setSelected({});
    setOverrides({});
    setSearch("");
    setBoOnly(false);
    setSaOnly(false);
    setBrandFilter("all");
    setStatusFilter("all");
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
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search supplier name..." value={search}
                onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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
            onClick={() => refreshStock(currentSupplier?.rows.map((r) => r.sku) || [])}
            disabled={refreshing || !currentSupplier}
            title="Pull live stock AND low-stock-alert (LSA) levels from Mintsoft for this supplier's SKUs, then recompute the recommendations"
          >
            {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh stock & LSA
          </Button>
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
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allOnPageSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                    </TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">LSA</TableHead>
                    <TableHead className="text-right">BO</TableHead>
                    <TableHead className="text-right" title="Units sold in last 28 days">Sales 4W</TableHead>
                    <TableHead className="text-right">On Order</TableHead>
                    <TableHead className="text-right">Suggest Qty</TableHead>
                    <TableHead className="text-right">Est. Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                   {detailRows.map((r) => {
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
    </div>
  );
};

export default BuyRecommendations;
