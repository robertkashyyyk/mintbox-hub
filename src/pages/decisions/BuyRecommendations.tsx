import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Truck, Package, PoundSterling, Loader2, FilePlus2 } from "lucide-react";
import { useBuyRecommendationsRpc, useBuyRecommendationsSummary, type BuyRecommendationRow } from "@/hooks/useBuyRecommendationsRpc";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const formatGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n || 0);
const formatGBPDetailed = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const ALL = "__all__";

const statusBadge = (row: BuyRecommendationRow) => {
  if (row.status === "po_sent_pending") {
    return <Badge className="bg-pd-accent text-pd-accent-foreground">PO Sent — Awaiting ASN</Badge>;
  }
  if (row.back_orders > 0 && row.current_stock < row.low_stock_alert) {
    return <Badge variant="destructive">Critical</Badge>;
  }
  if (row.back_orders > 0) return <Badge className="bg-warning text-warning-foreground">Backorder</Badge>;
  if (row.current_stock < row.low_stock_alert) return <Badge variant="secondary">Low Stock</Badge>;
  return <Badge variant="outline">OK</Badge>;
};

const BuyRecommendations = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: rows = [], isLoading } = useBuyRecommendationsRpc({ includePending: true });
  const { data: summary } = useBuyRecommendationsSummary();

  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>(ALL);
  const [boOnly, setBoOnly] = useState(false);
  const [saOnly, setSaOnly] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);

  // Build brand list from rows (id+name)
  const brands = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.brand_id && r.brand_name) map.set(r.brand_id, r.brand_name);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.status === "po_sent_pending") return false; // suppress from active list
      if (brandFilter !== ALL && r.brand_id !== brandFilter) return false;
      if (boOnly && !(r.back_orders > 0)) return false;
      if (saOnly && !(r.current_stock < r.low_stock_alert)) return false;
      if (q && !(r.sku.toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, brandFilter, boOnly, saOnly]);

  // Clear selections that fall outside current filtered list
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(filtered.map((r) => r.sku));
      const next: Record<string, boolean> = {};
      for (const k of Object.keys(prev)) if (prev[k] && valid.has(k)) next[k] = true;
      return next;
    });
  }, [filtered]);

  const selectedRows = useMemo(
    () => filtered.filter((r) => selected[r.sku]),
    [filtered, selected]
  );

  const allOnPageSelected = filtered.length > 0 && filtered.every((r) => selected[r.sku]);

  const pendingCount = rows.filter((r) => r.status === "po_sent_pending").length;

  const stats = useMemo(() => {
    const totalUnits = filtered.reduce((a, r) => a + (overrides[r.sku] ?? r.required_qty), 0);
    const totalSpend = filtered.reduce((a, r) => a + (overrides[r.sku] ?? r.required_qty) * (r.unit_cost || 0), 0);
    const supplierCount = new Set(filtered.map((r) => r.supplier_id || "__u__")).size;
    return { totalSkus: filtered.length, totalUnits, totalSpend, supplierCount };
  }, [filtered, overrides]);

  const selectionSummary = useMemo(() => {
    const supplierIds = new Set(selectedRows.map((r) => r.supplier_id || ""));
    const units = selectedRows.reduce((a, r) => a + (overrides[r.sku] ?? r.required_qty), 0);
    const cost = selectedRows.reduce((a, r) => a + (overrides[r.sku] ?? r.required_qty) * (r.unit_cost || 0), 0);
    return { count: selectedRows.length, supplierCount: supplierIds.size, units, cost };
  }, [selectedRows, overrides]);

  const toggleAll = () => {
    if (allOnPageSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      filtered.forEach((r) => (next[r.sku] = true));
      setSelected(next);
    }
  };

  const createDraftPoFromSelection = async () => {
    if (selectedRows.length === 0) return;
    // Group by supplier
    const groups = new Map<string, { supplierId: string; supplierName: string; items: BuyRecommendationRow[] }>();
    for (const r of selectedRows) {
      if (!r.supplier_id) {
        toast({
          title: "Unmapped SKU in selection",
          description: `${r.sku} has no supplier mapped. Fix in Suppliers admin.`,
          variant: "destructive",
        });
        return;
      }
      const k = r.supplier_id;
      if (!groups.has(k)) groups.set(k, { supplierId: k, supplierName: r.supplier_name || "Supplier", items: [] });
      groups.get(k)!.items.push(r);
    }

    setCreating(true);
    const sb = supabase as any;
    const createdIds: string[] = [];
    try {
      for (const g of groups.values()) {
        const totalUnits = g.items.reduce((a, r) => a + (overrides[r.sku] ?? Math.max(0, Math.round(r.required_qty))), 0);
        const totalCost = g.items.reduce((a, r) => a + (overrides[r.sku] ?? Math.max(0, Math.round(r.required_qty))) * (r.unit_cost || 0), 0);

        const { data: po, error: poErr } = await sb
          .from("purchase_orders")
          .insert({
            supplier_id: g.supplierId,
            status: "draft",
            po_number: `PO-${Date.now()}-${g.supplierName.slice(0, 3).toUpperCase()}`,
            total_qty: totalUnits,
            total_cost: totalCost,
          })
          .select("id")
          .single();
        if (poErr) throw poErr;

        const lines = g.items
          .map((r) => ({
            po_id: po.id,
            sku: r.sku,
            product_name: r.product_name,
            qty_ordered: overrides[r.sku] ?? Math.max(0, Math.round(r.required_qty)),
            unit_cost: r.unit_cost,
            snapshot_live_stock: r.current_stock,
            snapshot_on_order: r.on_order,
            snapshot_back_orders: r.back_orders,
            snapshot_low_stock_alert: r.low_stock_alert,
          }))
          .filter((l) => l.qty_ordered > 0);
        if (lines.length === 0) continue;

        const { error: linesErr } = await sb.from("purchase_order_lines").insert(lines);
        if (linesErr) throw linesErr;
        createdIds.push(po.id);
      }

      if (createdIds.length === 0) {
        toast({ title: "Nothing to order", description: "All selected lines had qty 0.", variant: "destructive" });
        return;
      }
      toast({
        title: `${createdIds.length} draft PO${createdIds.length === 1 ? "" : "s"} created`,
        description: `For ${groups.size} supplier${groups.size === 1 ? "" : "s"}.`,
      });
      setSelected({});
      if (createdIds.length === 1) navigate(`/execution/purchase-orders/${createdIds[0]}`);
      else navigate("/execution/purchase-orders");
    } catch (e: any) {
      toast({ title: "Could not create PO", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Buy Recommendations</h1>
          <p className="text-foreground/60">Select SKUs and create draft purchase orders. Advisory only.</p>
        </div>
        {pendingCount > 0 && (
          <Badge className="bg-pd-accent text-pd-accent-foreground">
            {pendingCount} SKU{pendingCount === 1 ? "" : "s"} suppressed (PO sent — awaiting ASN)
          </Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Suppliers in view</CardTitle>
          <Truck className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.supplierCount}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">SKUs</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSkus.toLocaleString()}</div>
            {summary && summary.recommended_count !== stats.totalSkus && (
              <p className="text-xs text-muted-foreground">of {Number(summary.recommended_count).toLocaleString()} total</p>
            )}
          </CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Units</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalUnits.toLocaleString()}</div>
            {summary && Number(summary.total_required_qty) !== stats.totalUnits && (
              <p className="text-xs text-muted-foreground">of {Number(summary.total_required_qty).toLocaleString()} total</p>
            )}
          </CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Estimated spend</CardTitle>
          <PoundSterling className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatGBP(stats.totalSpend)}</div>
            {summary && Math.round(Number(summary.total_required_cost)) !== Math.round(stats.totalSpend) && (
              <p className="text-xs text-muted-foreground">of {formatGBP(Number(summary.total_required_cost))} total</p>
            )}
          </CardContent></Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search SKU or product name..." value={search}
                onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Brand</Label>
              <Select value={brandFilter} onValueChange={setBrandFilter}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All brands</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="bo-only" checked={boOnly} onCheckedChange={setBoOnly} />
              <Label htmlFor="bo-only" className="cursor-pointer text-sm">BO Only</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="sa-only" checked={saOnly} onCheckedChange={setSaOnly} />
              <Label htmlFor="sa-only" className="cursor-pointer text-sm">SA Only</Label>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {selectionSummary.count > 0 && (
                <span className="text-xs text-muted-foreground">
                  {selectionSummary.count} selected • {selectionSummary.supplierCount} supplier{selectionSummary.supplierCount === 1 ? "" : "s"} • {formatGBP(selectionSummary.cost)}
                </span>
              )}
              <Button
                variant="outline"
                disabled={creating || selectionSummary.count === 0}
                onClick={createDraftPoFromSelection}
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
                Create Draft PO
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {isLoading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Loading recommendations…</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No recommendations match the current filters.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allOnPageSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Supplier</TableHead>
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
                  {filtered.map((r) => {
                    const qty = overrides[r.sku] ?? Math.max(0, Math.round(r.required_qty));
                    const lineCost = qty * (r.unit_cost || 0);
                    return (
                      <TableRow key={r.sku} data-state={selected[r.sku] ? "selected" : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={!!selected[r.sku]}
                            onCheckedChange={(v) =>
                              setSelected({ ...selected, [r.sku]: !!v })
                            }
                            aria-label={`Select ${r.sku}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Link to={`/discovery/products/${r.sku}`} className="text-primary hover:underline font-mono text-xs">
                            {r.sku}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{r.product_name || "—"}</TableCell>
                        <TableCell className="text-sm">{r.brand_name || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-sm">
                          {r.supplier_name || <span className="text-destructive">Unmapped</span>}
                        </TableCell>
                        <TableCell>{statusBadge(r)}</TableCell>
                        <TableCell className="text-right">{r.current_stock}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{r.low_stock_alert}</TableCell>
                        <TableCell className="text-right">
                          {r.back_orders > 0
                            ? <span className="text-warning font-medium">{r.back_orders}</span>
                            : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.sales_4w > 0 ? r.sales_4w : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{r.on_order || 0}</TableCell>
                        <TableCell className="text-right">
                          <Input type="number" min={0} value={qty}
                            onChange={(e) => setOverrides({ ...overrides, [r.sku]: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                            className="h-8 w-20 ml-auto text-right" />
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatGBPDetailed(lineCost)}</TableCell>
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
