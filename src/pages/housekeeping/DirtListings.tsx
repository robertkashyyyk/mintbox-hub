import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/PageLoader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tag, ChevronLeft, ChevronRight, ExternalLink, ArrowUpDown, AlertTriangle, Download, Wrench } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ModuleHeader from "@/components/ModuleHeader";

interface Row {
  dirt_sku: string; true_sku: string; store_name: string | null; external_item_id: string | null;
  units_90d: number; revenue_90d: number | null; last_sold: string | null;
  true_name: string | null; true_cost: number | null; true_stock: number | null; needs_review: boolean;
  pushable: boolean; hold_reason: string | null; status: "auto" | "pack" | "nocost" | "other";
  pack_override: number | null;
}

const gbp = (n: number | null) => (n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n));
const PAGE_OPTIONS = [25, 50, 100, 250];
type SortKey = "revenue_90d" | "units_90d" | "last_sold" | "dirt_sku";
type StatusFilter = "all" | "auto" | "pack" | "nocost";
const STATUS_META: Record<string, { label: string; cls: string }> = {
  auto:   { label: "Auto-cleaning", cls: "text-success border-success/40" },
  pack:   { label: "Needs -Q SKU",  cls: "text-warning border-warning/40" },
  nocost: { label: "No live cost",  cls: "text-destructive border-destructive/40" },
  other:  { label: "Held",          cls: "text-muted-foreground border-border" },
};
const FILTER_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "auto", label: "Auto-cleaning" },
  { key: "pack", label: "Held · needs -Q SKU" },
  { key: "nocost", label: "Held · no live cost" },
];

export default function DirtListings() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortKey, setSortKey] = useState<SortKey>("revenue_90d");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [resolveRow, setResolveRow] = useState<Row | null>(null);
  const [packN, setPackN] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const openResolve = (r: Row) => { setResolveRow(r); setPackN(r.pack_override && r.pack_override >= 2 ? String(r.pack_override) : ""); };
  const baseSku = (sku: string) => sku.replace(/-Q\d{2}$/, "");

  const resolveMutation = useMutation({
    mutationFn: async ({ dirt, size }: { dirt: string; size: number | null }) => {
      const { data, error } = await (supabase as any).rpc("set_dirt_pack_override", { p_dirt_sku: dirt, p_size: size });
      if (error) throw error;
      return data as Row;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dirt-listings"] });
      if (data?.status === "auto") toast({ title: "Sent for cleaning ✓", description: `${data.dirt_sku} → ${data.true_sku}` });
      else toast({ title: "Updated", description: data?.hold_reason ?? "Held" });
      setResolveRow(null);
    },
    onError: (e: any) => toast({ title: "Couldn't update", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["dirt-listings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_dirt_listings");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, auto: 0, pack: 0, nocost: 0, other: 0 };
    for (const r of rows ?? []) { c.all++; c[r.status] = (c[r.status] ?? 0) + 1; }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = (rows ?? []).filter((x) =>
      (statusFilter === "all" || x.status === statusFilter) &&
      (!q || x.dirt_sku.toLowerCase().includes(q) || x.true_sku.toLowerCase().includes(q) ||
      (x.true_name ?? "").toLowerCase().includes(q) || (x.store_name ?? "").toLowerCase().includes(q)));
    const dir = sortDir === "asc" ? 1 : -1;
    r = [...r].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null) return 1; if (bv == null) return -1;
      if (sortKey === "dirt_sku" || sortKey === "last_sold") return dir * String(av).localeCompare(String(bv));
      return dir * (Number(av) - Number(bv));
    });
    return r;
  }, [rows, search, statusFilter, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalRevenue = useMemo(() => (rows ?? []).reduce((s, r) => s + (r.revenue_90d ?? 0), 0), [rows]);
  const toggleSort = (k: SortKey) => { if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir("desc"); } };
  function download(name: string, rows: string[][]) {
    const blob = new Blob([rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = name; a.click();
  }
  // Full report (analysis) — respects the current status filter.
  function exportCsv() {
    download(`dirt-listings-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["eBayItemId", "CurrentDirtSKU", "TrueSKU", "Store", "Status", "HoldReason", "Units90d", "Revenue90d", "LastSold", "TrueName", "TrueCost"],
      ...filtered.map((r) => [r.external_item_id ?? "", r.dirt_sku, r.true_sku, r.store_name ?? "",
        STATUS_META[r.status]?.label ?? r.status, r.hold_reason ?? "", String(r.units_90d),
        String(r.revenue_90d ?? ""), r.last_sold ? r.last_sold.slice(0, 10) : "", r.true_name ?? "", String(r.true_cost ?? "")]),
    ]);
  }
  // 3D-ready: Current SKU -> True SKU (the format 3D's CSV/SFTP custom-label update expects).
  function export3d() {
    download(`3d-sku-update-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Current SKU", "True SKU"],
      ...filtered.map((r) => [r.dirt_sku, r.true_sku]),
    ]);
  }

  const Sort = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground">
      {label}<ArrowUpDown className={`h-3 w-3 ${sortKey === k ? "text-pd-accent" : "text-muted-foreground/40"}`} />
    </button>
  );

  return (
    <div className="space-y-4">
      <ModuleHeader title="Dirt SKUs on eBay" description="Live eBay listings whose custom label is an old 'dirt' code. Most now auto-clean weekly (the true SKU is pushed to eBay via 3D Sellers every Tuesday). The rest are held back and need a person: genuine multipacks need their -Q variant SKU created first, and a few have no live cost. Use the tabs to work each group." icon={Tag} />
      <Card>
        <CardHeader className="pb-3 space-y-3">
          <div className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">
            {isLoading ? "…" : <><strong>{filtered.length}</strong> {statusFilter === "all" ? "dirt listings" : STATUS_META[statusFilter]?.label.toLowerCase()} · <span className="text-muted-foreground font-normal">{gbp(totalRevenue)} sold in last 90d</span></>}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search dirt/true SKU, name, store" className="w-[260px]" />
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>{PAGE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}/page</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading || filtered.length === 0}>
              <Download className="h-4 w-4 mr-2" />Report
            </Button>
            <Button size="sm" onClick={export3d} disabled={isLoading || filtered.length === 0} title="Current SKU → True SKU, ready for 3D's custom-label update">
              <Download className="h-4 w-4 mr-2" />3D update CSV
            </Button>
          </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTER_TABS.map((t) => {
              const n = counts[t.key] ?? 0;
              const active = statusFilter === t.key;
              return (
                <button key={t.key} onClick={() => { setStatusFilter(t.key); setPage(1); }}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${active ? "border-pd-accent bg-pd-accent/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"}`}>
                  {t.label}
                  <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-pd-accent/20" : "bg-muted"}`}>{isLoading ? "…" : n}</span>
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <PageLoader rows={10} columns={[160, 160, 110, 110, 70, 90, 100, 80, 70]} label="Loading dirt listings" />
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No dirt SKUs detected. 🎉</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><Sort k="dirt_sku" label="Dirt SKU (on eBay)" /></TableHead>
                    <TableHead>True SKU</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead className="text-right"><Sort k="units_90d" label="Units 90d" /></TableHead>
                    <TableHead className="text-right"><Sort k="revenue_90d" label="Revenue 90d" /></TableHead>
                    <TableHead><Sort k="last_sold" label="Last sold" /></TableHead>
                    <TableHead className="text-right">True cost</TableHead>
                    <TableHead className="text-right">eBay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow key={`${r.dirt_sku}-${r.store_name}`}>
                      <TableCell className="font-mono text-xs">
                        {r.dirt_sku}
                        {r.needs_review && <Badge variant="outline" className="ml-2 text-[10px] text-warning border-warning/40"><AlertTriangle className="h-3 w-3 mr-0.5" />review</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-pd-accent">{r.true_sku}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-[10px] ${STATUS_META[r.status]?.cls ?? ""}`}
                            title={r.hold_reason ?? "Pushed to eBay automatically on the next weekly run"}>
                            {STATUS_META[r.status]?.label ?? r.status}
                          </Badge>
                          {(r.status === "pack" || r.status === "nocost" || r.pack_override != null) && (
                            <button onClick={() => openResolve(r)} className="inline-flex items-center gap-0.5 text-[10px] text-pd-accent hover:underline">
                              <Wrench className="h-3 w-3" />Resolve
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{r.store_name ?? "—"}</TableCell>
                      <TableCell className="text-right">{r.units_90d}</TableCell>
                      <TableCell className="text-right">{gbp(r.revenue_90d)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.last_sold ? r.last_sold.slice(0, 10) : "—"}</TableCell>
                      <TableCell className="text-right">{r.true_cost == null ? <span className="text-destructive text-xs">no cost</span> : gbp(r.true_cost)}</TableCell>
                      <TableCell className="text-right">
                        {r.external_item_id ? (
                          <a href={`https://www.ebay.co.uk/itm/${r.external_item_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-pd-accent hover:underline text-xs">
                            open <ExternalLink className="h-3 w-3 ml-0.5" />
                          </a>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {pageCount > 1 && (
                <div className="flex items-center justify-end gap-2 pt-3 text-sm">
                  <span className="text-muted-foreground">Page {page} of {pageCount}</span>
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!resolveRow} onOpenChange={(o) => !o && setResolveRow(null)}>
        <DialogContent className="max-w-md">
          {resolveRow && (
            <>
              <DialogHeader>
                <DialogTitle>Resolve held listing</DialogTitle>
                <DialogDescription className="font-mono text-xs break-all">{resolveRow.dirt_sku}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <p className="text-muted-foreground text-xs">{resolveRow.true_name ?? "—"}</p>

                <div className="rounded-lg border p-3">
                  <div className="font-medium mb-1">It's a single — or the mapped SKU is already the pack</div>
                  <p className="text-xs text-muted-foreground mb-2">Cleans the eBay label to <span className="font-mono">{baseSku(resolveRow.true_sku)}</span> as-is.</p>
                  <Button size="sm" variant="secondary" disabled={resolveMutation.isPending}
                    onClick={() => resolveMutation.mutate({ dirt: resolveRow.dirt_sku, size: 1 })}>
                    Mark correct → send for cleaning
                  </Button>
                </div>

                <div className="rounded-lg border p-3">
                  <div className="font-medium mb-1">It's a multipack</div>
                  <p className="text-xs text-muted-foreground mb-2">Type the pack size — the label becomes the <span className="font-mono">-Q</span> variant and is pushed now. If that SKU isn't in Mintsoft yet, the next sale flags it for creation.</p>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="packN" className="text-xs">Pack of</Label>
                    <Input id="packN" value={packN} onChange={(e) => setPackN(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                      inputMode="numeric" placeholder="12" className="w-16 h-8" />
                    {packN && Number(packN) >= 2 && (
                      <span className="font-mono text-xs text-pd-accent">→ {baseSku(resolveRow.true_sku)}-Q{packN.padStart(2, "0")}</span>
                    )}
                  </div>
                  <Button size="sm" className="mt-2" disabled={resolveMutation.isPending || !packN || Number(packN) < 2}
                    onClick={() => resolveMutation.mutate({ dirt: resolveRow.dirt_sku, size: Number(packN) })}>
                    Send pack for cleaning
                  </Button>
                </div>

                {resolveRow.pack_override != null && (
                  <button className="text-xs text-muted-foreground hover:underline" disabled={resolveMutation.isPending}
                    onClick={() => resolveMutation.mutate({ dirt: resolveRow.dirt_sku, size: null })}>
                    Reset to auto-detect
                  </button>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setResolveRow(null)}>Cancel</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
