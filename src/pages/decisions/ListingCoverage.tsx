/**
 * Listing Coverage — Phase B.1: stock we own that is NOT live on any UK eBay
 * account ("Unlisted"). Driven by get_ebay_unlisted_skus (diff of products_cache
 * vs the listing_coverage map synced from 3D Sellers). Lets you raise a task for
 * the catalogue owner (Jon) per row or in bulk. Amazon (ASIN) axis lands in B.2.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { EyeOff, PoundSterling, Boxes, AlertTriangle, Download, Send, Loader2, RefreshCw } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { PageLoader } from "@/components/ui/PageLoader";

interface Unlisted {
  sku: string; product_name: string | null; brand_name: string | null;
  current_stock: number; cost_price: number; capital_tied: number;
  velocity_per_week: number; units_sold_90d: number | null; last_sold: string | null;
  priority: "high" | "medium" | "low";
}

const PRIORITY_META: Record<string, { label: string; className: string; rank: number }> = {
  high:   { label: "High",   className: "bg-red-500/15 text-red-400 border-red-500/30", rank: 0 },
  medium: { label: "Medium", className: "bg-amber-500/15 text-amber-400 border-amber-500/30", rank: 1 },
  low:    { label: "Low",    className: "bg-muted/40 text-muted-foreground border-border", rank: 2 },
};

async function raiseUnlistedTask(row: Unlisted) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  // Owner = configured catalogue owner (Jon), else unassigned.
  const { data: owner } = await (supabase as any).from("app_settings").select("value").eq("key", "coverage_owner").maybeSingle();
  const ownerId = (owner?.value && typeof owner.value === "string") ? owner.value : null;
  // Dedup: skip if an open task already exists for this SKU.
  const { data: existing } = await (supabase as any).from("tasks").select("id")
    .eq("source_rule", "unlisted_sku").eq("linked_entity_id", row.sku)
    .in("status", ["todo", "in_progress", "blocked"]).limit(1);
  if (existing && existing.length) return "exists";
  const priorityLevel = row.priority === "high" ? 2 : row.priority === "medium" ? 3 : 4;
  const { error } = await (supabase as any).from("tasks").insert({
    created_by: user.id, assigned_to: ownerId, task_type: "system_generated",
    title: `Unlisted on eBay: ${row.sku}`,
    description: `${row.product_name ?? row.sku} has ${row.current_stock} in stock (£${Number(row.capital_tied).toFixed(0)} capital) but is not live on any UK eBay store${(row.units_sold_90d ?? 0) > 0 ? ` — and it has sold ${row.units_sold_90d} in the last 90 days` : ""}. List it.`,
    priority_level: priorityLevel,
    linked_entity_type: "sku", linked_entity_id: row.sku, linked_entity_label: row.sku,
    source_module: "catalogue", source_rule: "unlisted_sku", tags: ["coverage", "unlisted"],
  });
  if (error) throw new Error(error.message);
  return "created";
}

export default function ListingCoverage() {
  const [priority, setPriority] = useState("all");
  const [brand, setBrand] = useState("all");
  const [minCapital, setMinCapital] = useState(25);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [raising, setRaising] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["ebay-unlisted", minCapital],
    queryFn: async (): Promise<Unlisted[]> => {
      const { data, error } = await (supabase as any).rpc("get_ebay_unlisted_skus", { min_capital: minCapital, limit_n: 1000 });
      if (error) throw error;
      return data as Unlisted[];
    },
  });

  const { data: sync } = useQuery({
    queryKey: ["coverage-sync"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("listing_coverage_sync").select("*").eq("channel", "ebay").maybeSingle();
      return data as { last_run_at: string | null; rows_upserted: number | null } | null;
    },
  });

  const brands = useMemo(() => Array.from(new Set(rows.map(r => r.brand_name).filter(Boolean) as string[])).sort(), [rows]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return rows.filter(r =>
      (priority === "all" || r.priority === priority) &&
      (brand === "all" || r.brand_name === brand) &&
      (!s || r.sku.toLowerCase().includes(s) || (r.product_name ?? "").toLowerCase().includes(s)),
    );
  }, [rows, priority, brand, search]);

  const totalCapital = filtered.reduce((a, r) => a + Number(r.capital_tied), 0);
  const highCount = filtered.filter(r => r.priority === "high").length;
  const selectedRows = filtered.filter(r => selected.has(r.sku));

  async function raiseSelected() {
    setRaising(true);
    let created = 0, skipped = 0, failed = 0;
    for (const r of selectedRows) {
      try { (await raiseUnlistedTask(r)) === "created" ? created++ : skipped++; } catch { failed++; }
    }
    setRaising(false);
    setSelected(new Set());
    toast.success(`Tasks — ${created} raised, ${skipped} already open${failed ? `, ${failed} failed` : ""}`);
  }

  const raiseOne = useMutation({
    mutationFn: raiseUnlistedTask,
    onSuccess: (r) => toast.success(r === "created" ? "Task raised for Jon" : "Already has an open task"),
    onError: (e: any) => toast.error(e.message),
  });

  function exportCsv() {
    const hdr = ["SKU", "Product", "Brand", "Stock", "Cost", "CapitalTied", "Velocity/wk", "Sold90d", "LastSold", "Priority"];
    const lines = filtered.map(r => [r.sku, r.product_name ?? "", r.brand_name ?? "", r.current_stock, r.cost_price,
      r.capital_tied, r.velocity_per_week, r.units_sold_90d ?? 0, r.last_sold ?? "never", r.priority]
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[hdr.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `ebay-unlisted-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }

  const allPageSelected = filtered.length > 0 && filtered.every(r => selected.has(r.sku));

  return (
    <div className="space-y-6">
      <ModuleHeader title="Opportunities" description="In stock but not listed on any UK eBay store — capital tied up in things we can't sell yet. List them to unlock the sales. Clearance diverts unlisted SKUs straight here. (Amazon coverage coming next.)" icon={EyeOff} />

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="h-3 w-3" />
        {sync?.last_run_at
          ? <>Coverage last synced {new Date(sync.last_run_at).toLocaleString()} · {sync.rows_upserted?.toLocaleString()} active eBay listings</>
          : <span className="text-amber-400">No coverage sync yet — run <code>sync-ebay-coverage.ts</code> or every SKU will show as unlisted.</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Unlisted SKUs" value={filtered.length.toLocaleString()} icon={Boxes} />
        <Stat label="Capital tied up" value={`£${totalCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} className="text-orange-400" icon={PoundSterling} />
        <Stat label="High priority" value={highCount.toLocaleString()} className="text-red-400" icon={AlertTriangle} />
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1.5"><Label className="text-xs">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Brand</Label>
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All brands</SelectItem>{brands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Min capital £</Label><Input type="number" value={minCapital} onChange={e => setMinCapital(Number(e.target.value) || 0)} className="w-24 h-9" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Search</Label><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="SKU or name" className="w-48 h-9" /></div>
          <div className="ml-auto flex items-end gap-2">
            {selected.size > 0 && <Button size="sm" className="h-9" disabled={raising} onClick={raiseSelected}>{raising ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Raise {selected.size} task(s) for Jon</Button>}
            <Button size="sm" variant="outline" className="h-9" onClick={exportCsv} disabled={filtered.length === 0}><Download className="h-4 w-4 mr-2" />Export</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <PageLoader rows={12} columns={[30, 110, 180, 60, 70, 90, 70, 70, 90, 70, 90]} label="Loading unlisted SKUs" /> : (
            <Table containerClassName="max-h-[calc(100vh-300px)]">
              <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead className="w-8"><Checkbox checked={allPageSelected} onCheckedChange={v => setSelected(prev => { const n = new Set(prev); filtered.forEach(r => v ? n.add(r.sku) : n.delete(r.sku)); return n; })} /></TableHead>
                  <TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Brand</TableHead>
                  <TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Capital</TableHead><TableHead className="text-right">Sold 90d</TableHead>
                  <TableHead className="text-right">Last sold</TableHead><TableHead>Priority</TableHead><TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">Nothing unlisted at these filters.</TableCell></TableRow>}
                {filtered.map(r => (
                  <TableRow key={r.sku}>
                    <TableCell><Checkbox checked={selected.has(r.sku)} onCheckedChange={v => setSelected(prev => { const n = new Set(prev); v ? n.add(r.sku) : n.delete(r.sku); return n; })} /></TableCell>
                    <TableCell><Link to={`/discovery/products?search=${encodeURIComponent(r.sku)}`} className="font-mono text-xs text-pd-accent hover:underline">{r.sku}</Link></TableCell>
                    <TableCell className="text-sm max-w-[180px] truncate">{r.product_name ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.brand_name ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm">{r.current_stock}</TableCell>
                    <TableCell className="text-right text-sm">£{Number(r.cost_price).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold text-orange-400">£{Number(r.capital_tied).toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell className="text-right text-sm">{r.units_sold_90d ?? 0}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{r.last_sold ?? <span className="text-destructive">never</span>}</TableCell>
                    <TableCell><Badge variant="outline" className={`text-xs ${PRIORITY_META[r.priority]?.className}`}>{PRIORITY_META[r.priority]?.label}</Badge></TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="outline" className="h-7 text-xs" disabled={raiseOne.isPending} onClick={() => raiseOne.mutate(r)}><Send className="h-3 w-3 mr-1" />Task</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, className = "", icon: Icon }: { label: string; value: string; className?: string; icon?: React.ElementType }) {
  return (<Card><CardContent className="pt-6"><div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">{Icon && <Icon className="h-3 w-3" />}{label}</div><div className={`text-2xl font-bold mt-1 ${className}`}>{value}</div></CardContent></Card>);
}
