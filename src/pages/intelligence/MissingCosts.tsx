import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/PageLoader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Download, Save } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { logActivity, LOG_ACTIONS } from "@/lib/activityLog";

type Row = {
  id: string;
  sku: string;
  name: string | null;
  suppliers: string | null;
  current_stock: number | null;
  brand_id: string | null;
  brand_name?: string | null;
  mintsoft_id: number | null;
  units_28d: number;
  last_sold: string | null;
};

type SortKey = "sku" | "name" | "brand_name" | "suppliers" | "current_stock" | "units_28d" | "last_sold";

const PAGE_OPTIONS = [25, 50, 100, 250, 500];

// Paginated fetcher to bypass the 1000-row Supabase cap
async function fetchAllProductsMissingCost() {
  const all: any[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("products_cache")
      .select("id, sku, name, suppliers, current_stock, brand_id, mintsoft_id")
      .or("cost_price.is.null,cost_price.lte.0")
      .eq("discontinued", false)
      .eq("quarantined", false)
      .not("mintsoft_id", "is", null)
      .order("sku", { ascending: true })
      .range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return all;
}

async function fetchRecentSold(days: number) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const all: any[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("order_line_economics")
      .select("sku, qty, order_date")
      .eq("missing_cost", true)
      .gte("order_date", since)
      .range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < step) break;
    from += step;
  }
  // aggregate by sku
  const map = new Map<string, { units: number; last: string | null }>();
  for (const r of all) {
    const cur = map.get(r.sku) ?? { units: 0, last: null };
    cur.units += Number(r.qty ?? 0);
    if (!cur.last || (r.order_date && r.order_date > cur.last)) cur.last = r.order_date;
    map.set(r.sku, cur);
  }
  return map;
}

const MissingCosts = () => {
  const qc = useQueryClient();

  // Filters
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<string>("all"); // all|in_stock|out|positive
  const [soldFilter, setSoldFilter] = useState<string>("all"); // all|sold_28|sold_7
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("units_28d");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Inline edit state — keyed by product id
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const { data: brands } = useQuery({
    queryKey: ["brands-list-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: products, isLoading: loadingProducts } = useQuery({
    queryKey: ["missing-costs-all"],
    queryFn: fetchAllProductsMissingCost,
  });

  const { data: sold28 } = useQuery({
    queryKey: ["missing-costs-sold-28"],
    queryFn: () => fetchRecentSold(28),
  });

  const { data: sold7 } = useQuery({
    queryKey: ["missing-costs-sold-7"],
    queryFn: () => fetchRecentSold(7),
  });

  const brandMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of brands ?? []) m.set(b.id, b.name);
    return m;
  }, [brands]);

  const rows: Row[] = useMemo(() => {
    if (!products) return [];
    return products.map((p) => {
      const s = sold28?.get(p.sku);
      return {
        ...p,
        brand_name: p.brand_id ? brandMap.get(p.brand_id) ?? null : null,
        units_28d: s?.units ?? 0,
        last_sold: s?.last ?? null,
      } as Row;
    });
  }, [products, sold28, brandMap]);

  const filtered = useMemo(() => {
    let r = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(
        (x) =>
          x.sku.toLowerCase().includes(q) ||
          (x.name ?? "").toLowerCase().includes(q) ||
          (x.suppliers ?? "").toLowerCase().includes(q)
      );
    }
    if (brandFilter !== "all") {
      r = brandFilter === "none" ? r.filter((x) => !x.brand_id) : r.filter((x) => x.brand_id === brandFilter);
    }
    if (stockFilter === "in_stock") r = r.filter((x) => (x.current_stock ?? 0) > 0);
    else if (stockFilter === "out") r = r.filter((x) => (x.current_stock ?? 0) <= 0);
    else if (stockFilter === "positive") r = r.filter((x) => (x.current_stock ?? 0) > 0);

    if (soldFilter === "sold_28") r = r.filter((x) => x.units_28d > 0);
    else if (soldFilter === "sold_7") {
      const set = sold7;
      r = r.filter((x) => (set?.get(x.sku)?.units ?? 0) > 0);
    }

    const sorted = [...r].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, search, brandFilter, stockFilter, soldFilter, sold7, sortKey, sortDir]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const recentImpact = useMemo(() => {
    if (!sold28) return { unique: 0, units: 0 };
    let units = 0;
    for (const v of sold28.values()) units += v.units;
    return { unique: sold28.size, units };
  }, [sold28]);

  // Classify the sold-28d SKUs against the cache to break the banner down
  const { data: skuClassification } = useQuery({
    queryKey: ["missing-costs-sold28-classification", sold28 ? Array.from(sold28.keys()).length : 0],
    enabled: !!sold28 && sold28.size > 0,
    queryFn: async () => {
      const skus = Array.from(sold28!.keys());
      const found = new Map<string, { quarantined: boolean; discontinued: boolean }>();
      const chunkSize = 500;
      for (let i = 0; i < skus.length; i += chunkSize) {
        const chunk = skus.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("products_cache")
          .select("sku, quarantined, discontinued")
          .in("sku", chunk);
        if (error) throw error;
        for (const r of data ?? []) found.set(r.sku, { quarantined: !!r.quarantined, discontinued: !!r.discontinued });
      }
      let editable = 0, quarantined = 0, discontinued = 0, orphan = 0;
      for (const sku of skus) {
        const f = found.get(sku);
        if (!f) orphan++;
        else if (f.quarantined) quarantined++;
        else if (f.discontinued) discontinued++;
        else editable++;
      }
      return { editable, quarantined, discontinued, orphan };
    },
  });

  // Sortable column header
  const Th = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) => {
    const active = sortKey === k;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead className={align === "right" ? "text-right" : ""}>
        <button
          type="button"
          onClick={() => {
            if (active) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
            else { setSortKey(k); setSortDir("desc"); }
            setPage(1);
          }}
          className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : "text-foreground/70"}`}
        >
          {label}
          <Icon className="h-3.5 w-3.5" />
        </button>
      </TableHead>
    );
  };

  async function saveOne(row: Row) {
    const raw = edits[row.id];
    const val = Number(raw);
    if (!Number.isFinite(val) || val <= 0 || val > 100000) {
      toast.error("Enter a valid cost between 0 and 100,000");
      return;
    }
    if (!row.mintsoft_id) {
      toast.error(`No Mintsoft product ID for ${row.sku}`);
      return;
    }
    setSaving((s) => ({ ...s, [row.id]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("update-product-cost", {
        body: { items: [{ mintsoft_product_id: row.mintsoft_id, sku: row.sku, cost_price: val }] },
      });
      if (error) throw error;
      const result = data?.results?.[0];
      if (!result?.ok) throw new Error(result?.error ?? "Unknown error");
      logActivity({ action: LOG_ACTIONS.COST_UPDATE, entityType: "product", entityId: row.id, entityLabel: row.sku, detail: { cost_price: val } });
      toast.success(`${row.sku}: cost £${val.toFixed(2)} sent to Mintsoft`);
      setEdits((e) => { const n = { ...e }; delete n[row.id]; return n; });
      qc.setQueryData(["missing-costs-all"], (old: any[] | undefined) => (old ?? []).filter((p) => p.id !== row.id));
      qc.invalidateQueries({ queryKey: ["missing-costs-all"] });
    } catch (e: any) {
      toast.error(`${row.sku}: ${e?.message ?? "Save failed"}`);
    } finally {
      setSaving((s) => { const n = { ...s }; delete n[row.id]; return n; });
    }
  }

  function exportCsv() {
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["SKU", "Product", "Brand", "Suppliers", "Stock", "Units 28d", "Last sold", "Mintsoft ID"];
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push([
        r.sku,
        r.name ?? "",
        r.brand_name ?? "",
        r.suppliers ?? "",
        r.current_stock ?? 0,
        r.units_28d ?? 0,
        r.last_sold ? new Date(r.last_sold).toISOString().slice(0, 10) : "",
        r.mintsoft_id ?? "",
      ].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const brandPart = brandFilter !== "all" && brandFilter !== "none"
      ? "-" + (brandMap.get(brandFilter) ?? "brand").replace(/[^a-z0-9]+/gi, "_")
      : "";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `missing-costs${brandPart}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function saveAllPage() {
    const items = pageRows
      .filter((r) => edits[r.id] && r.mintsoft_id)
      .map((r) => ({
        row: r,
        val: Number(edits[r.id]),
      }))
      .filter(({ val }) => Number.isFinite(val) && val > 0 && val <= 100000);

    if (items.length === 0) {
      toast.error("No valid cost prices entered on this page");
      return;
    }
    const chunks: typeof items[] = [];
    for (let i = 0; i < items.length; i += 50) chunks.push(items.slice(i, i + 50));

    let okCount = 0;
    let failCount = 0;
    for (const ch of chunks) {
      const payload = ch.map(({ row, val }) => ({
        mintsoft_product_id: row.mintsoft_id!,
        sku: row.sku,
        cost_price: val,
      }));
      try {
        const { data, error } = await supabase.functions.invoke("update-product-cost", { body: { items: payload } });
        if (error) throw error;
        okCount += data?.successCount ?? 0;
        failCount += data?.failCount ?? 0;
        for (const r of data?.results ?? []) {
          if (r.ok) {
            const match = ch.find((c) => c.row.sku === r.sku);
            if (match) {
              setEdits((e) => { const n = { ...e }; delete n[match.row.id]; return n; });
              qc.setQueryData(["missing-costs-all"], (old: any[] | undefined) => (old ?? []).filter((p) => p.id !== match.row.id));
            }
          }
        }
      } catch (e: any) {
        failCount += ch.length;
        toast.error(`Batch failed: ${e?.message}`);
      }
    }
    if (okCount > 0) {
      logActivity({ action: LOG_ACTIONS.COST_BULK_UPDATE, detail: { updated: okCount, failed: failCount }, outcome: failCount > 0 ? "failure" : "success" });
      toast.success(`${okCount} cost prices sent to Mintsoft${failCount ? ` · ${failCount} failed` : ""}`);
    }
    qc.invalidateQueries({ queryKey: ["missing-costs-all"] });
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Missing Cost Prices"
        description="Without a cost price we cannot compute profit. Edit cost inline and push back to Mintsoft."
        icon={AlertCircle}
      />

      <Card className="border-destructive/40">
        <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm space-y-1">
            <div>
              <span className="font-semibold text-destructive">{recentImpact.unique}</span> SKUs sold in the last 28 days have no cost set
              <span className="text-foreground/60"> ({recentImpact.units} units).</span>
            </div>
            {skuClassification && (
              <div className="text-xs text-foreground/60">
                <span className="text-foreground/80 font-medium">{skuClassification.editable.toLocaleString()}</span> editable here
                {skuClassification.quarantined > 0 && (
                  <> · <Link to="/intelligence/dirt-skus" className="text-pd-accent hover:underline">{skuClassification.quarantined.toLocaleString()} quarantined (Dirt SKUs)</Link></>
                )}
                {skuClassification.orphan > 0 && (
                  <> · <Link to="/discovery/discovery-queue" className="text-pd-accent hover:underline">{skuClassification.orphan.toLocaleString()} missing from catalogue</Link></>
                )}
                {skuClassification.discontinued > 0 && (
                  <> · {skuClassification.discontinued.toLocaleString()} discontinued</>
                )}
              </div>
            )}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/intelligence/profit">Open Profit dashboard</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catalogue items without cost</CardTitle>
          <CardDescription>
            {loadingProducts ? "Loading…" : `${total.toLocaleString()} SKUs match your filters.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search SKU, name or supplier…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="max-w-xs"
            />
            <Select value={brandFilter} onValueChange={(v) => { setBrandFilter(v); setPage(1); }}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Brand" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All brands</SelectItem>
                <SelectItem value="none">No brand</SelectItem>
                {(brands ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={stockFilter} onValueChange={(v) => { setStockFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Stock" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stock</SelectItem>
                <SelectItem value="in_stock">In stock</SelectItem>
                <SelectItem value="out">Out of stock</SelectItem>
              </SelectContent>
            </Select>
            <Select value={soldFilter} onValueChange={(v) => { setSoldFilter(v); setPage(1); }}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Sold recently" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any (sold or not)</SelectItem>
                <SelectItem value="sold_28">Sold last 28 days</SelectItem>
                <SelectItem value="sold_7">Sold last 7 days</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
                <Download className="h-4 w-4 mr-1" /> Export CSV ({filtered.length.toLocaleString()})
              </Button>
              <Button size="sm" onClick={saveAllPage} disabled={Object.keys(edits).length === 0}>
                <Save className="h-4 w-4 mr-1" /> Save edited rows
              </Button>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_OPTIONS.map((n) => (<SelectItem key={n} value={String(n)}>{n}/page</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {loadingProducts ? (
            <PageLoader rows={8} columns={[120, 280, 100, 80]} label="Loading missing costs" />
          ) : pageRows.length === 0 ? (
            <div className="text-sm text-foreground/60 py-6 text-center">No matches.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <Th k="sku" label="SKU" />
                    <Th k="name" label="Name" />
                    <Th k="brand_name" label="Brand" />
                    <Th k="suppliers" label="Suppliers" />
                    <Th k="current_stock" label="Stock" align="right" />
                    <Th k="units_28d" label="Sold 28d" align="right" />
                    <Th k="last_sold" label="Last sold" />
                    <TableHead className="text-right">Cost £</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((p) => {
                    const editVal = edits[p.id] ?? "";
                    const isSaving = !!saving[p.id];
                    const noMs = !p.mintsoft_id;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                        <TableCell className="max-w-md truncate">{p.name ?? "—"}</TableCell>
                        <TableCell className="text-xs">{p.brand_name ?? <span className="text-foreground/40">—</span>}</TableCell>
                        <TableCell className="text-xs text-foreground/70">{p.suppliers ?? "—"}</TableCell>
                        <TableCell className="text-right">{p.current_stock ?? 0}</TableCell>
                        <TableCell className="text-right">{p.units_28d || ""}</TableCell>
                        <TableCell className="text-xs text-foreground/70">
                          {p.last_sold ? new Date(p.last_sold).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={editVal}
                            onChange={(e) => setEdits((s) => ({ ...s, [p.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") saveOne(p); }}
                            className="w-24 ml-auto h-8 text-right"
                            disabled={isSaving || noMs}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => saveOne(p)}
                              disabled={isSaving || noMs || !editVal}
                              title={noMs ? "No Mintsoft product ID — cannot push" : "Save and push to Mintsoft"}
                            >
                              {isSaving ? "Saving…" : "Save"}
                            </Button>
                            <Button asChild variant="ghost" size="sm">
                              <Link to={`/discovery/products/${p.id}`}>Open</Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm pt-2">
            <div className="text-foreground/60">
              Showing {pageRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
              {(safePage - 1) * pageSize + pageRows.length} of {total.toLocaleString()}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(1)}>« First</Button>
              <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</Button>
              <span className="px-2">Page {safePage} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}>Next ›</Button>
              <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>Last »</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MissingCosts;
