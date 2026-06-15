import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/PageLoader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tag, ChevronLeft, ChevronRight } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface Row { id: string; sku: string; name: string | null; brand_id: string | null; current_stock: number | null; mintsoft_id: number | null; }

async function fetchAll(): Promise<Row[]> {
  const all: Row[] = []; let from = 0; const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("products_cache")
      .select("id, sku, name, brand_id, current_stock, mintsoft_id")
      .or("barcode.is.null,barcode.eq.")
      .eq("discontinued", false).eq("quarantined", false).not("mintsoft_id", "is", null)
      .order("current_stock", { ascending: false }).range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < step) break;
    from += step;
  }
  return all;
}

const PAGE_OPTIONS = [25, 50, 100, 250];

export default function MissingBarcodes() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const { data: rows, isLoading } = useQuery({ queryKey: ["missing-barcodes"], queryFn: fetchAll });
  const { data: brands } = useQuery({
    queryKey: ["brands-min"],
    queryFn: async () => { const { data } = await supabase.from("brands").select("id, name"); return (data ?? []) as { id: string; name: string }[]; },
  });
  const brandName = (id: string | null) => brands?.find((b) => b.id === id)?.name ?? "—";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || r.sku.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q));
  }, [rows, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  async function saveRow(r: Row) {
    const val = (edits[r.id] ?? "").trim();
    if (val.length < 4) { toast.error("Enter a valid barcode (4+ chars)"); return; }
    if (!r.mintsoft_id) { toast.error(`No Mintsoft ID for ${r.sku}`); return; }
    setSaving((s) => ({ ...s, [r.id]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("update-product-barcode", {
        body: { items: [{ mintsoft_product_id: r.mintsoft_id, sku: r.sku, barcode: val }] },
      });
      if (error) throw error;
      const res = data?.results?.[0];
      if (!res?.ok) throw new Error(res?.error ?? "Save failed");
      toast.success(`${r.sku}: barcode ${val} sent to Mintsoft`);
      setEdits((e) => { const n = { ...e }; delete n[r.id]; return n; });
      qc.setQueryData(["missing-barcodes"], (old: Row[] | undefined) => (old ?? []).filter((p) => p.id !== r.id));
    } catch (e: any) {
      toast.error(`${r.sku}: ${e?.message ?? "Save failed"}`);
    } finally {
      setSaving((s) => { const n = { ...s }; delete n[r.id]; return n; });
    }
  }

  return (
    <div className="space-y-4">
      <ModuleHeader title="Missing Barcodes" description="Active products with no UPC/EAN barcode. Add one to push it straight to Mintsoft." icon={Tag} />
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">
            {isLoading ? "…" : <><strong>{filtered.length}</strong> products without a barcode</>}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search SKU / name" className="w-[240px]" />
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>{PAGE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}/page</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <PageLoader rows={10} columns={[140, 280, 120, 70, 180, 80]} label="Loading missing barcodes" />
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No products are missing a barcode. 🎉</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Brand</TableHead>
                    <TableHead className="text-right">Stock</TableHead><TableHead>Barcode (UPC/EAN)</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs"><Link to={`/discovery/products/${r.id}`} className="text-primary hover:underline">{r.sku}</Link></TableCell>
                      <TableCell className="max-w-md truncate">{r.name ?? "—"}</TableCell>
                      <TableCell className="text-xs">{brandName(r.brand_id)}</TableCell>
                      <TableCell className="text-right">{r.current_stock ?? "—"}</TableCell>
                      <TableCell>
                        <Input value={edits[r.id] ?? ""} onChange={(e) => setEdits((ed) => ({ ...ed, [r.id]: e.target.value }))}
                          placeholder="e.g. 5012345678900" className="h-8 w-44 font-mono text-xs" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" className="h-8" disabled={!r.mintsoft_id || saving[r.id] || (edits[r.id] ?? "").trim().length < 4} onClick={() => saveRow(r)}>
                          {saving[r.id] ? "Saving…" : "Save"}
                        </Button>
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
