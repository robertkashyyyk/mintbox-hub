import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/PageLoader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Download, Loader2, Save, Search } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { logActivity, LOG_ACTIONS } from "@/lib/activityLog";
import WeeklyMissingCostList from "./WeeklyMissingCostList";

type Row = {
  id: string;
  sku: string;
  name: string | null;
  suppliers: string | null;
  current_stock: number | null;
  brand_id: string | null;
  brand_name: string | null;
  mintsoft_id: number | null;
  units_28d: number;
  units_7d: number;
  last_sold: string | null;
};

type BrandSummary = {
  brand_id: string | null;
  brand_name: string;
  missing_count: number;
  sold_28d_skus: number;
  sold_28d_units: number;
};

type SortKey = "sku" | "name" | "suppliers" | "current_stock" | "units_28d" | "last_sold";

const PAGE_OPTIONS = [25, 50, 100, 250, 500];
const UNMAPPED = "__unmapped__";
const chipKeyOf = (s: BrandSummary) => s.brand_id ?? UNMAPPED;

const MissingCosts = () => {
  const qc = useQueryClient();

  // Which brand chip is selected (null = none loaded yet)
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [chipSearch, setChipSearch] = useState("");

  // Row-level filters (operate on the loaded brand's rows — small set, fast)
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<string>("all"); // all|in_stock|out
  const [soldFilter, setSoldFilter] = useState<string>("all"); // all|sold_28|sold_7
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("units_28d");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Inline edit state — keyed by product id
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // Cheap grouped aggregate → the brand chips
  const { data: summary = [], isLoading: loadingSummary } = useQuery({
    queryKey: ["missing-cost-brand-summary"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("missing_cost_brand_summary");
      if (error) throw error;
      return (data ?? []) as BrandSummary[];
    },
  });

  // Rows for the selected brand only (server-side)
  const { data: rows = [], isLoading: loadingRows } = useQuery({
    queryKey: ["missing-cost-rows", selectedKey],
    enabled: !!selectedKey,
    queryFn: async () => {
      const unmapped = selectedKey === UNMAPPED;
      const { data, error } = await (supabase as any).rpc("missing_costs_for_brand", {
        p_brand_id: unmapped ? null : selectedKey,
        p_unmapped: unmapped,
      });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const totals = useMemo(() => {
    let missing = 0, soldSkus = 0, units = 0;
    for (const s of summary) { missing += s.missing_count; soldSkus += s.sold_28d_skus; units += Number(s.sold_28d_units); }
    return { missing, soldSkus, units };
  }, [summary]);

  const visibleChips = useMemo(() => {
    const q = chipSearch.trim().toLowerCase();
    return q ? summary.filter((s) => s.brand_name.toLowerCase().includes(q)) : summary;
  }, [summary, chipSearch]);

  const selectedName = useMemo(
    () => summary.find((s) => chipKeyOf(s) === selectedKey)?.brand_name ?? "",
    [summary, selectedKey]
  );

  const filtered = useMemo(() => {
    let r = rows;
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((x) => x.sku.toLowerCase().includes(q) || (x.name ?? "").toLowerCase().includes(q) || (x.suppliers ?? "").toLowerCase().includes(q));
    if (stockFilter === "in_stock") r = r.filter((x) => (x.current_stock ?? 0) > 0);
    else if (stockFilter === "out") r = r.filter((x) => (x.current_stock ?? 0) <= 0);
    if (soldFilter !== "all") {
      const days = soldFilter === "sold_7" ? 7 : soldFilter === "sold_90" ? 90 : 28;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      r = r.filter((x) => x.last_sold != null && new Date(x.last_sold).getTime() >= cutoff);
    }

    const sorted = [...r].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return sorted;
  }, [rows, search, stockFilter, soldFilter, sortKey, sortDir]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function selectChip(key: string) {
    setSelectedKey(key);
    setSearch(""); setStockFilter("all"); setSoldFilter("all"); setPage(1); setEdits({});
  }

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

  function afterSaved(savedSkus: string[]) {
    const set = new Set(savedSkus);
    qc.setQueryData<Row[]>(["missing-cost-rows", selectedKey], (old) => (old ?? []).filter((r) => !set.has(r.sku)));
    qc.invalidateQueries({ queryKey: ["missing-cost-brand-summary"] });
  }

  async function saveOne(row: Row) {
    const val = Number(edits[row.id]);
    if (!Number.isFinite(val) || val <= 0 || val > 100000) { toast.error("Enter a valid cost between 0 and 100,000"); return; }
    if (!row.mintsoft_id) { toast.error(`No Mintsoft product ID for ${row.sku}`); return; }
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
      afterSaved([row.sku]);
    } catch (e: any) {
      toast.error(`${row.sku}: ${e?.message ?? "Save failed"}`);
    } finally {
      setSaving((s) => { const n = { ...s }; delete n[row.id]; return n; });
    }
  }

  async function saveAllPage() {
    const items = pageRows
      .filter((r) => edits[r.id] && r.mintsoft_id)
      .map((r) => ({ row: r, val: Number(edits[r.id]) }))
      .filter(({ val }) => Number.isFinite(val) && val > 0 && val <= 100000);
    if (items.length === 0) { toast.error("No valid cost prices entered on this page"); return; }

    const chunks: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += 50) chunks.push(items.slice(i, i + 50));
    let okCount = 0, failCount = 0;
    const savedSkus: string[] = [];
    for (const ch of chunks) {
      const payload = ch.map(({ row, val }) => ({ mintsoft_product_id: row.mintsoft_id!, sku: row.sku, cost_price: val }));
      try {
        const { data, error } = await supabase.functions.invoke("update-product-cost", { body: { items: payload } });
        if (error) throw error;
        okCount += data?.successCount ?? 0;
        failCount += data?.failCount ?? 0;
        for (const r of data?.results ?? []) {
          if (r.ok) {
            const match = ch.find((c) => c.row.sku === r.sku);
            if (match) { setEdits((e) => { const n = { ...e }; delete n[match.row.id]; return n; }); savedSkus.push(r.sku); }
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
      afterSaved(savedSkus);
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
        r.sku, r.name ?? "", r.brand_name ?? "", r.suppliers ?? "",
        r.current_stock ?? 0, r.units_28d ?? 0,
        r.last_sold ? new Date(r.last_sold).toISOString().slice(0, 10) : "",
        r.mintsoft_id ?? "",
      ].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const brandPart = "-" + (selectedName || "brand").replace(/[^a-z0-9]+/gi, "_");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `missing-costs${brandPart}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Missing Cost Prices"
        description="Without a cost price we cannot compute profit. Pick a brand, edit cost inline, and push back to Mintsoft."
        icon={AlertCircle}
      />

      <Card className="border-destructive/40">
        <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm">
            <span className="font-semibold text-destructive">{totals.missing.toLocaleString()}</span> SKUs have no cost set
            {" · "}
            <span className="font-semibold text-foreground/80">{totals.soldSkus.toLocaleString()}</span> of them sold in the last 28 days
            <span className="text-foreground/60"> ({totals.units.toLocaleString()} units)</span> — start with the brands that are actually selling.
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/intelligence/profit">Open Profit dashboard</Link>
          </Button>
        </CardContent>
      </Card>

      {/* Cron-generated weekly worklist (top missing-cost SKUs by velocity) */}
      <WeeklyMissingCostList />

      {/* Brand chips — sorted by 28-day sales impact, click to load */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">Brands with missing costs</CardTitle>
              <CardDescription>Pick a brand to load just its items (fast). Sorted by what's selling now.</CardDescription>
            </div>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Find a brand…" value={chipSearch} onChange={(e) => setChipSearch(e.target.value)} className="pl-8 h-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingSummary ? (
            <PageLoader rows={2} columns={[140, 140, 140, 140, 140]} label="Loading brands" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 max-h-72 overflow-y-auto pr-1">
              {visibleChips.map((s) => {
                const key = chipKeyOf(s);
                const active = key === selectedKey;
                const hot = s.sold_28d_skus > 0;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectChip(key)}
                    className={`text-left rounded-lg border px-3 py-2 transition cursor-pointer hover:brightness-125
                      ${key === UNMAPPED ? "border-amber-500/40 bg-amber-500/10" : hot ? "border-pd-accent/40 bg-pd-accent/5" : "border-border bg-muted/30"}
                      ${active ? "ring-2 ring-offset-1 ring-offset-background ring-current" : ""}`}
                  >
                    <div className="text-sm font-semibold leading-tight truncate">{s.brand_name}</div>
                    <div className="text-xs text-muted-foreground">{s.missing_count.toLocaleString()} missing</div>
                    <div className="text-[10px] text-muted-foreground/70">
                      {hot ? `${s.sold_28d_skus} selling · ${Number(s.sold_28d_units).toLocaleString()}u/28d` : "none sold 28d"}
                    </div>
                  </button>
                );
              })}
              {visibleChips.length === 0 && <div className="text-sm text-foreground/60 py-4">No brands match.</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected brand worklist */}
      {selectedKey && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{selectedName || "Brand"} — items without cost</CardTitle>
            <CardDescription>{loadingRows ? "Loading…" : `${total.toLocaleString()} SKUs match your filters.`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="Search SKU, name or supplier…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
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
                  <SelectItem value="sold_7">Sold last 7 days</SelectItem>
                  <SelectItem value="sold_28">Sold last 28 days</SelectItem>
                  <SelectItem value="sold_90">Sold last 90 days</SelectItem>
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

            {loadingRows ? (
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
                          <TableCell className="max-w-md truncate" title={p.name ?? ""}>{p.name ?? "—"}</TableCell>
                          <TableCell className="text-xs text-foreground/70">{p.suppliers ?? "—"}</TableCell>
                          <TableCell className="text-right">{p.current_stock ?? 0}</TableCell>
                          <TableCell className="text-right">{p.units_28d || ""}</TableCell>
                          <TableCell className="text-xs text-foreground/70">{p.last_sold ? new Date(p.last_sold).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00"
                              value={editVal}
                              onChange={(e) => setEdits((s) => ({ ...s, [p.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") saveOne(p); }}
                              className="w-24 ml-auto h-8 text-right"
                              disabled={isSaving || noMs}
                              title={noMs ? "No Mintsoft product ID" : undefined}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" onClick={() => saveOne(p)} disabled={isSaving || noMs || !edits[p.id]}>
                              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                <div className="flex items-center justify-between gap-4 pt-3 flex-wrap text-sm text-muted-foreground">
                  <span>
                    {total === 0 ? "0 rows" : `${((safePage - 1) * pageSize + 1).toLocaleString()}–${Math.min(safePage * pageSize, total).toLocaleString()} of ${total.toLocaleString()}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(1)}>« First</Button>
                    <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>‹ Prev</Button>
                    <span className="tabular-nums">Page {safePage} / {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}>Next ›</Button>
                    <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>Last »</Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!selectedKey && !loadingSummary && (
        <div className="text-sm text-foreground/60 py-8 text-center">Pick a brand above to load its missing costs.</div>
      )}
    </div>
  );
};

export default MissingCosts;
