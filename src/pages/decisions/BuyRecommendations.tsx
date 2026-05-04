import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Search, Truck, Package, PoundSterling, Loader2 } from "lucide-react";
import { useBuyRecommendationsRpc, type BuyRecommendationRow } from "@/hooks/useBuyRecommendationsRpc";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const formatGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n || 0);
const formatGBPDetailed = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const UNASSIGNED_KEY = "__unassigned__";

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
  const [search, setSearch] = useState("");
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [openItems, setOpenItems] = useState<string[]>([]);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.sku.toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q));
  }, [rows, search]);

  const bySupplier = useMemo(() => {
    const map = new Map<string, BuyRecommendationRow[]>();
    for (const r of filtered) {
      if (r.status === "po_sent_pending") continue; // suppress from grouped order view
      const key = r.supplier_id || UNASSIGNED_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [filtered]);

  const sections = useMemo(() => {
    const out = Array.from(bySupplier.entries()).map(([key, items]) => {
      const totalUnits = items.reduce((a, r) => a + (overrides[r.sku] ?? r.required_qty), 0);
      const estCost = items.reduce((a, r) => a + (overrides[r.sku] ?? r.required_qty) * (r.unit_cost || 0), 0);
      return {
        key,
        supplierId: key === UNASSIGNED_KEY ? null : key,
        supplierName: items[0]?.supplier_name || (key === UNASSIGNED_KEY ? "Unassigned (no supplier match)" : "Unknown"),
        skuCount: items.length,
        totalUnits, estCost, items,
      };
    });
    out.sort((a, b) => b.estCost - a.estCost);
    return out;
  }, [bySupplier, overrides]);

  const pendingCount = filtered.filter((r) => r.status === "po_sent_pending").length;

  const stats = {
    supplierCount: sections.length,
    totalSkus: sections.reduce((a, s) => a + s.skuCount, 0),
    totalSpend: sections.reduce((a, s) => a + s.estCost, 0),
  };

  const toggleAll = () => {
    const all = sections.map((s) => s.key);
    setOpenItems(openItems.length === all.length ? [] : all);
  };

  const createDraftPo = async (section: typeof sections[number]) => {
    setCreatingFor(section.key);
    try {
      const sb = supabase as any;
      const { data: po, error: poErr } = await sb
        .from("purchase_orders")
        .insert({
          supplier_id: section.supplierId,
          status: "draft",
          po_number: `PO-${Date.now()}`,
          total_qty: section.totalUnits,
          total_cost: section.estCost,
        })
        .select("id")
        .single();
      if (poErr) throw poErr;

      const lines = section.items
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

      if (lines.length === 0) throw new Error("No lines with qty > 0");

      const { error: linesErr } = await sb.from("purchase_order_lines").insert(lines);
      if (linesErr) throw linesErr;

      toast({ title: "Draft PO created", description: `${lines.length} lines for ${section.supplierName}` });
      navigate(`/execution/purchase-orders/${po.id}`);
    } catch (e: any) {
      toast({ title: "Could not create PO", description: e.message, variant: "destructive" });
    } finally {
      setCreatingFor(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Buy Recommendations</h1>
          <p className="text-foreground/60">Suggested purchase orders grouped by supplier. Advisory only.</p>
        </div>
        {pendingCount > 0 && (
          <Badge className="bg-pd-accent text-pd-accent-foreground">
            {pendingCount} SKU{pendingCount === 1 ? "" : "s"} suppressed (PO sent — awaiting ASN)
          </Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Suppliers to order from</CardTitle>
          <Truck className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.supplierCount}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total SKUs</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.totalSkus.toLocaleString()}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Estimated spend</CardTitle>
          <PoundSterling className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatGBP(stats.totalSpend)}</div></CardContent></Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[260px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search SKU or product name..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button variant="outline" onClick={toggleAll} disabled={sections.length === 0}>
          {openItems.length === sections.length && sections.length > 0 ? "Collapse all" : "Expand all"}
        </Button>
      </div>

      {isLoading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Loading recommendations…</CardContent></Card>
      ) : sections.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No purchase recommendations right now.</CardContent></Card>
      ) : (
        <Accordion type="multiple" value={openItems} onValueChange={setOpenItems} className="space-y-3">
          {sections.map((section) => (
            <AccordionItem key={section.key} value={section.key} className="border rounded-lg bg-card px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center justify-between gap-4 w-full pr-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-base font-semibold text-left">{section.supplierName}</span>
                    <Badge variant="secondary">{section.skuCount} SKU{section.skuCount === 1 ? "" : "s"}</Badge>
                    <Badge variant="outline">{section.totalUnits.toLocaleString()} units</Badge>
                  </div>
                  <span className="text-base font-semibold whitespace-nowrap">{formatGBP(section.estCost)}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 pb-2">
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead>Product Name</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Stock</TableHead>
                          <TableHead className="text-right">LSA</TableHead>
                          <TableHead className="text-right">Backorders</TableHead>
                          <TableHead className="text-right">On Order</TableHead>
                          <TableHead className="text-right">Suggest Qty</TableHead>
                          <TableHead className="text-right">Est. Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {section.items.map((r) => {
                          const qty = overrides[r.sku] ?? Math.max(0, Math.round(r.required_qty));
                          const lineCost = qty * (r.unit_cost || 0);
                          return (
                            <TableRow key={r.sku}>
                              <TableCell>
                                <Link to={`/discovery/products/${r.sku}`} className="text-primary hover:underline font-mono text-xs">
                                  {r.sku}
                                </Link>
                              </TableCell>
                              <TableCell className="max-w-xs truncate">{r.product_name || "—"}</TableCell>
                              <TableCell>{statusBadge(r)}</TableCell>
                              <TableCell className="text-right">{r.current_stock}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{r.low_stock_alert}</TableCell>
                              <TableCell className="text-right">
                                {r.back_orders > 0
                                  ? <span className="text-warning font-medium">{r.back_orders}</span>
                                  : <span className="text-muted-foreground">0</span>}
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
                  <div className="flex justify-end">
                    <Button variant="outline"
                      disabled={creatingFor === section.key || !section.supplierId}
                      title={!section.supplierId ? "Cannot create PO for unassigned supplier" : ""}
                      onClick={() => createDraftPo(section)}>
                      {creatingFor === section.key && <Loader2 className="h-4 w-4 animate-spin" />}
                      Create Draft PO
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
};

export default BuyRecommendations;
