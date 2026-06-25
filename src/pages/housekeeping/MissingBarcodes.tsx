import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/PageLoader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, ChevronLeft, ChevronRight, UploadCloud, Loader2 } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface Row {
  id: string; sku: string; name: string | null; brand_id: string | null; mintsoft_id: number | null;
  barcode: string | null; height: number | null; length: number | null; depth: number | null; weight: number | null;
}
type Field = "barcode" | "length" | "depth" | "height" | "weight";

// Server-side, single-page fetch (was pulling the ENTIRE matching set client-side = very slow).
async function fetchPage(opts: { page: number; pageSize: number; search: string; brand: string; issue: string }): Promise<{ rows: Row[]; hasNext: boolean }> {
  const { page, pageSize, search, brand, issue } = opts;
  let q = supabase
    .from("products_cache")
    .select("id, sku, name, brand_id, mintsoft_id, barcode, height, length, depth, weight")
    .eq("discontinued", false).eq("quarantined", false).not("mintsoft_id", "is", null);
  if (issue === "barcode") q = q.or("barcode.is.null,barcode.eq.");
  else if (issue === "dims") q = q.or("height.is.null,length.is.null,depth.is.null");
  else if (issue === "weight") q = q.is("weight", null);
  else q = q.or("barcode.is.null,barcode.eq.,height.is.null,length.is.null,depth.is.null,weight.is.null");
  if (brand !== "all") q = q.eq("brand_id", brand);
  const s = search.trim().replace(/[%,]/g, " ");
  if (s) q = q.or(`sku.ilike.%${s}%,name.ilike.%${s}%`);
  // fetch pageSize+1 to know whether a next page exists, without a full count
  q = q.order("current_stock", { ascending: false, nullsFirst: false }).range((page - 1) * pageSize, page * pageSize);
  const { data, error } = await q;
  if (error) throw error;
  const all = (data ?? []) as Row[];
  const hasNext = all.length > pageSize;
  return { rows: hasNext ? all.slice(0, pageSize) : all, hasNext };
}

const PAGE_OPTIONS = [25, 50, 100, 250];
const missingBarcode = (r: Row) => !r.barcode || String(r.barcode).trim() === "";
const missingDims = (r: Row) => r.height == null || r.length == null || r.depth == null;
const missingWeight = (r: Row) => r.weight == null;
const barcodeKind = (raw: string): "UPC" | "EAN" | null => {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length === 12 ? "UPC" : d.length === 13 ? "EAN" : null;
};

export default function MissingBarcodes() {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState(""); // debounced, used by the query
  const [brand, setBrand] = useState("all");
  const [issue, setIssue] = useState("all"); // all | barcode | dims | weight
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [edits, setEdits] = useState<Record<string, Partial<Record<Field, string>>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);

  // Debounce the search box so typing doesn't re-query on every keystroke.
  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 350); return () => clearTimeout(t); }, [searchInput]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["product-completeness", page, pageSize, search, brand, issue],
    queryFn: () => fetchPage({ page, pageSize, search, brand, issue }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const pageRows = data?.rows ?? [];
  const hasNext = data?.hasNext ?? false;

  const { data: brands } = useQuery({
    queryKey: ["brands-min"],
    queryFn: async () => { const { data } = await supabase.from("brands").select("id, name").order("name"); return (data ?? []) as { id: string; name: string }[]; },
  });
  const brandName = (id: string | null) => brands?.find((b) => b.id === id)?.name ?? "—";

  const cell = (r: Row, f: Field) => edits[r.id]?.[f] ?? (r[f] != null ? String(r[f]) : "");
  const setCell = (id: string, f: Field, v: string) => setEdits((e) => ({ ...e, [id]: { ...e[id], [f]: v } }));
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(pageRows.map((r) => r.id)));

  // Has the user actually changed any field on this row?
  const hasEdits = (r: Row) => { const e = edits[r.id]; return !!e && Object.values(e).some((v) => (v ?? "").trim() !== ""); };

  // Build a push item from ONLY the fields the user edited — untouched values are never sent,
  // so editing one field changes exactly that field (in the Hub + Mintsoft) and nothing else.
  function buildItem(r: Row): { item: any; error?: string } {
    if (!r.mintsoft_id) return { item: null, error: `${r.sku}: no Mintsoft ID` };
    const e = edits[r.id] ?? {};
    const item: any = { mintsoft_product_id: r.mintsoft_id, sku: r.sku };
    if (e.barcode !== undefined) {
      const bc = (e.barcode ?? "").trim();
      if (bc) { if (!barcodeKind(bc)) return { item: null, error: `${r.sku}: barcode must be 12 (UPC) or 13 (EAN) digits` }; item.barcode = bc; }
    }
    for (const f of ["length", "depth", "height", "weight"] as Field[]) {
      if (e[f] !== undefined) {
        const v = (e[f] ?? "").trim();
        if (v) { const n = Number(v); if (!Number.isFinite(n) || n <= 0) return { item: null, error: `${r.sku}: ${f} must be a positive number` }; item[f] = n; }
      }
    }
    if (Object.keys(item).length <= 2) return { item: null, error: `${r.sku}: no changes to push` };
    return { item };
  }

  async function pushRows(rs: Row[]) {
    const editedRows = rs.filter(hasEdits);
    if (!editedRows.length) { toast.error("Nothing changed — edit a value first"); return; }
    // Sanity check: a weight under 30g almost certainly means someone typed kg into the grams box.
    const looksKg = editedRows.filter((r) => { const w = (edits[r.id]?.weight ?? "").trim(); const n = Number(w); return w !== "" && Number.isFinite(n) && n > 0 && n < 30; });
    if (looksKg.length && !window.confirm(
      `These weights are under 30g — tiny for a part. This box is in GRAMS — did you mean kilograms?\n\n` +
      looksKg.map((r) => `${r.sku}: ${edits[r.id]?.weight} g  (→ ${(Number(edits[r.id]?.weight) / 1000).toFixed(3)} kg)`).join("\n") +
      `\n\nPush as grams anyway?`)) return;
    const items: any[] = [];
    for (const r of editedRows) { const { item, error } = buildItem(r); if (error) { toast.error(error); return; } items.push(item); }
    setPushing(true);
    try {
      let ok = 0, fail = 0, firstErr = "";
      const okSkus = new Set<string>();
      for (let i = 0; i < items.length; i += 50) {
        const { data, error } = await supabase.functions.invoke("update-product-fields", { body: { items: items.slice(i, i + 50) } });
        if (error) {
          let detail = error.message;
          try { const b = await (error as any).context?.json?.(); if (b?.error) detail = b.error; } catch { /* ignore */ }
          throw new Error(detail);
        }
        ok += data?.successCount ?? 0; fail += data?.failCount ?? 0;
        for (const r of (data?.results ?? [])) { if (r.ok) okSkus.add(r.sku); else if (!firstErr) firstErr = `${r.sku}: ${r.error}`; }
      }
      // single toast so the error is always visible (no overlapping success+error)
      if (fail > 0) toast.error(firstErr || `${fail} failed`, { description: ok ? `${ok} pushed, ${fail} failed` : undefined, duration: 8000 });
      else toast.success(`Pushed ${ok} to Mintsoft`);
      setSelected(new Set());
      setEdits((e) => { const n = { ...e }; for (const r of editedRows) if (okSkus.has(r.sku)) delete n[r.id]; return n; });
      qc.invalidateQueries({ queryKey: ["product-completeness"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Push failed");
    } finally { setPushing(false); }
  }

  const selectedRows = pageRows.filter((r) => selected.has(r.id));
  const numInput = (r: Row, f: Field, unit: string) => {
    const v = cell(r, f).trim();
    const n = Number(v);
    const kg = f === "weight" && v && Number.isFinite(n) ? ` → ${(n / 1000).toFixed(2)}kg` : "";
    const looksKg = f === "weight" && v !== "" && Number.isFinite(n) && n > 0 && n < 30; // <30g is implausible for a part
    return (
      <div className="flex items-center gap-1 whitespace-nowrap">
        <Input value={cell(r, f)} onChange={(e) => setCell(r.id, f, e.target.value)} inputMode="decimal"
          className={`h-8 w-14 text-xs ${v === "" ? "border-amber-500/50" : looksKg ? "border-amber-600" : ""}`} />
        <span className={`text-[10px] ${looksKg ? "text-amber-600 font-semibold" : "text-muted-foreground"}`}>{unit}{kg}{looksKg ? " ⚠ kg?" : ""}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <ModuleHeader title="Product Completeness"
        description="Active products missing a barcode, dimensions or weight. Fill the gaps and push straight to Mintsoft."
        icon={ClipboardCheck} />
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">
            Products with gaps{isFetching ? " …" : ""}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search SKU / name" className="w-[200px]" />
            <Select value={issue} onValueChange={(v) => { setIssue(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any gap</SelectItem>
                <SelectItem value="barcode">Missing barcode</SelectItem>
                <SelectItem value="dims">Missing dimensions</SelectItem>
                <SelectItem value="weight">Missing weight</SelectItem>
              </SelectContent>
            </Select>
            <Select value={brand} onValueChange={(v) => { setBrand(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Brand" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All brands</SelectItem>
                {(brands ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>{PAGE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}/page</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <PageLoader rows={10} columns={[30, 200, 120, 140, 60, 60, 60, 70, 90]} label="Loading products" />
          ) : pageRows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No gaps match these filters. 🎉</div>
          ) : (
            <>
              {selectedRows.length > 0 && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-muted/50 border">
                  <span className="text-sm font-medium">{selectedRows.length} selected</span>
                  <Button size="sm" variant="outline" className="h-7" disabled={pushing} onClick={() => pushRows(selectedRows)}>
                    {pushing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5 mr-1" />}
                    Push {selectedRows.length} to Mintsoft
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"><Checkbox checked={allSel} onCheckedChange={toggleAll} aria-label="Select all" /></TableHead>
                    <TableHead>SKU / Product</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Barcode (UPC/EAN)</TableHead>
                    <TableHead>Length</TableHead><TableHead>Depth</TableHead><TableHead>Height</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead className="text-right">Push</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => {
                    const bc = cell(r, "barcode").trim();
                    const k = bc ? barcodeKind(bc) : null;
                    return (
                      <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                        <TableCell className="w-8"><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSel(r.id)} aria-label={`Select ${r.sku}`} /></TableCell>
                        <TableCell className="max-w-[240px]">
                          <Link to={`/discovery/products/${r.id}`} className="font-medium text-primary hover:underline">{r.sku}</Link>
                          <div className="text-xs text-foreground/50 truncate">{r.name ?? "—"}</div>
                        </TableCell>
                        <TableCell className="text-xs">{brandName(r.brand_id)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Input value={cell(r, "barcode")} onChange={(e) => setCell(r.id, "barcode", e.target.value)}
                              placeholder="UPC/EAN" className={`h-8 w-40 font-mono text-xs ${missingBarcode(r) && !bc ? "border-amber-500/50" : ""}`} />
                            {bc && (k ? <Badge variant="outline" className="text-[10px]">{k}</Badge>
                              : <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">{bc.replace(/\D/g, "").length}d</Badge>)}
                          </div>
                        </TableCell>
                        <TableCell>{numInput(r, "length", "cm")}</TableCell>
                        <TableCell>{numInput(r, "depth", "cm")}</TableCell>
                        <TableCell>{numInput(r, "height", "cm")}</TableCell>
                        <TableCell>{numInput(r, "weight", "g")}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" className="h-8" disabled={pushing || !r.mintsoft_id || !hasEdits(r)} onClick={() => pushRows([r])}>
                            <UploadCloud className="h-3.5 w-3.5 mr-1" /> Push
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {(page > 1 || hasNext) && (
                <div className="flex items-center justify-end gap-2 pt-3 text-sm">
                  <span className="text-muted-foreground">Page {page}</span>
                  <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" disabled={!hasNext || isFetching} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
