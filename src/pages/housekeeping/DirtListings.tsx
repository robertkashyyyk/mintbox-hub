import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/PageLoader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tag, ChevronLeft, ChevronRight, ExternalLink, ArrowUpDown, AlertTriangle } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";

interface Row {
  dirt_sku: string; true_sku: string; store_name: string | null; external_item_id: string | null;
  units_90d: number; revenue_90d: number | null; last_sold: string | null;
  true_name: string | null; true_cost: number | null; true_stock: number | null; needs_review: boolean;
}

const gbp = (n: number | null) => (n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n));
const PAGE_OPTIONS = [25, 50, 100, 250];
type SortKey = "revenue_90d" | "units_90d" | "last_sold" | "dirt_sku";

export default function DirtListings() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortKey, setSortKey] = useState<SortKey>("revenue_90d");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["dirt-listings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_dirt_listings");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = (rows ?? []).filter((x) =>
      !q || x.dirt_sku.toLowerCase().includes(q) || x.true_sku.toLowerCase().includes(q) ||
      (x.true_name ?? "").toLowerCase().includes(q) || (x.store_name ?? "").toLowerCase().includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    r = [...r].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null) return 1; if (bv == null) return -1;
      if (sortKey === "dirt_sku" || sortKey === "last_sold") return dir * String(av).localeCompare(String(bv));
      return dir * (Number(av) - Number(bv));
    });
    return r;
  }, [rows, search, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalRevenue = useMemo(() => (rows ?? []).reduce((s, r) => s + (r.revenue_90d ?? 0), 0), [rows]);
  const toggleSort = (k: SortKey) => { if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(k); setSortDir("desc"); } };
  const Sort = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground">
      {label}<ArrowUpDown className={`h-3 w-3 ${sortKey === k ? "text-pd-accent" : "text-muted-foreground/40"}`} />
    </button>
  );

  return (
    <div className="space-y-4">
      <ModuleHeader title="Dirt SKUs on eBay" description="Live eBay listings whose custom label is an old 'dirt' code. Mintsoft maps them to the true SKU on arrival (so stock/picking works), but the listing label was never updated — which hid them from the repricer. The cost/repricing side is already auto-resolved; this is the list to clean at source." icon={Tag} />
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">
            {isLoading ? "…" : <><strong>{filtered.length}</strong> dirt listings · <span className="text-muted-foreground font-normal">{gbp(totalRevenue)} sold in last 90d</span></>}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search dirt/true SKU, name, store" className="w-[260px]" />
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>{PAGE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}/page</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <PageLoader rows={10} columns={[160, 160, 110, 70, 90, 100, 80, 70]} label="Loading dirt listings" />
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No dirt SKUs detected. 🎉</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><Sort k="dirt_sku" label="Dirt SKU (on eBay)" /></TableHead>
                    <TableHead>True SKU</TableHead>
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
    </div>
  );
}
