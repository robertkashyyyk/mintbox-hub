import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Gauge, Info, Loader2, RefreshCw, Search, Sparkles, Zap } from "lucide-react";
import { PageLoader } from "@/components/ui/PageLoader";
import { useLsaCalibration, type LsaCalibrationRow } from "@/hooks/useLsaCalibration";
import { useLsaBrandSummary } from "@/hooks/useLsaBrandSummary";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { logActivity, LOG_ACTIONS } from "@/lib/activityLog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const ALL = "__all__";
const ALL_STATUSES = ["critical", "low", "target", "high", "excess"] as const;
type StatusKey = (typeof ALL_STATUSES)[number];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "bg-destructive/15 text-destructive border-destructive/40" },
  low:      { label: "Low",      cls: "bg-warning/15 text-warning border-warning/40" },
  target:   { label: "Target",   cls: "bg-pd-accent/15 text-pd-accent border-pd-accent/40" },
  high:     { label: "High",     cls: "bg-warning/10 text-warning border-warning/30" },
  excess:   { label: "Excess",   cls: "bg-destructive/10 text-destructive border-destructive/30" },
  dormant:  { label: "Dormant",  cls: "bg-muted text-muted-foreground border-border" },
};

// No demand in window AND at/below the LSA floor (1 = Mintsoft default) → "dormant":
// nothing to do, so it's excluded from POT%. (The RPC still tags these 'excess'.)
const LSA_FLOOR = 1;
function effStatus(r: { current_lsa: number | string | null; target_lsa: number | string | null; status: string }): string {
  const tgt = Math.round(Number(r.target_lsa) || 0);
  const cur = Number(r.current_lsa) || 0;
  if (tgt <= 0 && cur <= LSA_FLOOR) return "dormant";
  return r.status;
}
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

// Distribution-bar bands, in order. Bar is scaled to the TOTAL in scope (dormant
// included, faded) — composition. The headline POT% stays target/managed in text.
const BAR_BANDS: { key: string; color: string }[] = [
  { key: "critical", color: "#E24B4A" },
  { key: "low",      color: "#EF9F27" },
  { key: "target",   color: "#1D9E75" },
  { key: "high",     color: "#85B7EB" },
  { key: "excess",   color: "#7F77DD" },
  { key: "dormant",  color: "#888780" },
];

const LsaCalibration = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const brandParam = searchParams.get("brand");      // null = brand grid
  const statusParam = searchParams.get("status") as StatusKey | null;
  const inDetail = !!brandParam;

  // ---- Brand-grid mode ----
  const { data: brandSummary = [], isLoading: brandsLoading, refetch: refetchBrandSummary, isRefetching } = useLsaBrandSummary();
  const [brandSearch, setBrandSearch] = useState("");

  // Auto-LSA flags by brand id
  const { data: autoBrandIds = new Set<string>() } = useQuery({
    queryKey: ["brands-auto-lsa-flags"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, auto_update_lsa")
        .eq("auto_update_lsa", true);
      if (error) throw error;
      return new Set<string>((data || []).map((b: any) => b.id));
    },
    staleTime: 5 * 60_000,
  });

  const filteredBrands = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    if (!q) return brandSummary;
    return brandSummary.filter(b => (b.brand_name || "").toLowerCase().includes(q));
  }, [brandSummary, brandSearch]);

  const totals = useMemo(() => {
    const t = { total: 0, critical: 0, low: 0, target: 0, high: 0, excess: 0, dormant: 0, active_total: 0 };
    for (const b of brandSummary) {
      t.total += b.total; t.critical += b.critical; t.low += b.low;
      t.target += b.target; t.high += b.high; t.excess += b.excess;
      t.dormant += (b.dormant ?? 0);
      t.active_total += (b.active_total ?? (b.total - (b.dormant ?? 0)));
    }
    return t;
  }, [brandSummary]);
  const totalsPot = totals.active_total > 0 ? Math.round((totals.target / totals.active_total) * 100) : null;

  const refreshSummary = async () => {
    const { error } = await (supabase as any).rpc("refresh_lsa_brand_summary");
    if (error) {
      toast({ title: "Refresh failed", description: error.message, variant: "destructive" });
    } else {
      await refetchBrandSummary();
      toast({ title: "Brand summary refreshed" });
    }
  };

  // ---- Detail mode ----
  const { data: rows = [], isLoading } = useLsaCalibration(inDetail ? brandParam : null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(statusParam ?? ALL);
  const [proposed, setProposed] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // sync status param into local state on enter
  useEffect(() => {
    if (inDetail) setStatusFilter(statusParam ?? ALL);
  }, [brandParam, statusParam, inDetail]);

  const detailBrandName = useMemo(() => {
    if (!inDetail) return "";
    const fromSummary = brandSummary.find(b => b.brand_id === brandParam);
    if (fromSummary?.brand_name) return fromSummary.brand_name;
    const fromRows = rows.find(r => r.brand_id === brandParam);
    return fromRows?.brand_name || "Brand";
  }, [inDetail, brandParam, brandSummary, rows]);


  // Brand list (for the inline brand selector inside detail mode)
  const brands = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of brandSummary) if (b.brand_id && b.brand_name) m.set(b.brand_id, b.brand_name);
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [brandSummary]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== ALL && effStatus(r) !== statusFilter) return false;
      if (q && !(r.sku.toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, pageSize, brandParam]);

  // Paged slice
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageRows = useMemo(
    () => filtered.slice(pageStart, pageStart + pageSize),
    [filtered, pageStart, pageSize]
  );

  // Trim selections outside current view
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(filtered.map((r) => r.sku));
      const next: Record<string, boolean> = {};
      for (const k of Object.keys(prev)) if (prev[k] && valid.has(k)) next[k] = true;
      return next;
    });
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { critical: 0, low: 0, target: 0, high: 0, excess: 0, dormant: 0 };
    for (const r of rows) { const s = effStatus(r); c[s] = (c[s] || 0) + 1; }
    return c;
  }, [rows]);
  // POT excludes dormant (no-demand floor stock — nothing to do).
  const detailActive = rows.length - (counts.dormant || 0);
  const detailPot = detailActive > 0 ? Math.round(((counts.target || 0) / detailActive) * 100) : null;

  const extractPrefix = (sku: string) => {
    if (!sku) return "—";
    const sep = sku.includes("/") ? "/" : "-";
    const head = sku.split(sep)[0];
    return head ? head.toUpperCase() : sku;
  };

  // Seed Proposed from the calculated Target LSA (fall back to current if target missing)
  const proposedFor = (r: LsaCalibrationRow) => {
    if (proposed[r.sku] !== undefined) return proposed[r.sku];
    const t = Number(r.target_lsa);
    if (Number.isFinite(t)) return Math.round(t);
    const c = Number(r.current_lsa);
    return Number.isFinite(c) ? Math.round(c) : 0;
  };

  const dirtyRows = useMemo(
    () => filtered.filter((r) => Math.round(proposedFor(r)) !== Math.round(r.current_lsa)),
    [filtered, proposed]
  );

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected[r.sku]);

  const applyTargetToFiltered = () => {
    setProposed((prev) => {
      const next = { ...prev };
      for (const r of filtered) next[r.sku] = Math.round(r.target_lsa);
      return next;
    });
    toast({ title: "Target applied", description: `${filtered.length} rows set to Target LSA.` });
  };

  const resetProposed = () => setProposed({});

  const updateMintsoft = useMutation({
    mutationFn: async (rowsToPush: LsaCalibrationRow[]) => {
      // Need mintsoft_product_id — fetch from products_cache
      const skus = rowsToPush.map((r) => r.sku);
      const { data: products, error: pErr } = await supabase
        .from("products_cache")
        .select("sku, mintsoft_id")
        .in("sku", skus);
      if (pErr) throw pErr;
      const idMap = new Map((products || []).map((p: any) => [p.sku, p.mintsoft_id]));
      const items = rowsToPush
        .map((r) => ({
          sku: r.sku,
          mintsoft_product_id: idMap.get(r.sku),
          low_stock_alert_level: Math.round(proposedFor(r)),
        }))
        .filter((it) => !!it.mintsoft_product_id);

      if (!items.length) throw new Error("No SKUs with a Mintsoft product ID to update.");

      const { data, error } = await supabase.functions.invoke("mintsoft-update-lsa", {
        body: { items },
      });
      if (error) throw error;
      return data as { updated: number; failed: number; results: Array<{ sku: string; ok: boolean; error?: string }> };
    },
    onSuccess: (res, rows) => {
      logActivity({
        action: LOG_ACTIONS.LSA_BULK_APPLY,
        entityType: "brand",
        entityLabel: detailBrandName || undefined,
        detail: { updated: res.updated, failed: res.failed, sku_count: rows.length },
        outcome: res.failed > 0 ? "failure" : "success",
      });
      toast({
        title: "Mintsoft updated",
        description: `${res.updated} updated, ${res.failed} failed.`,
        variant: res.failed > 0 ? "destructive" : "default",
      });
      setProposed({});
      setSelected({});
      qc.invalidateQueries({ queryKey: ["lsa-calibration"] });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message ?? String(e), variant: "destructive" }),
  });

  const selectedRows = useMemo(
    () => filtered.filter((r) => selected[r.sku]),
    [filtered, selected]
  );

  const pushSelectedOrDirty = () => {
    // Priority: explicit selection > dirty rows
    const target = selectedRows.length > 0 ? selectedRows : dirtyRows;
    if (!target.length) {
      toast({ title: "Nothing to push", description: "Select rows or change proposed values first.", variant: "destructive" });
      return;
    }
    updateMintsoft.mutate(target);
  };

  // Helpers for nav between brand-grid and detail
  const goToBrand = (brandId: string | null, status?: StatusKey) => {
    const next = new URLSearchParams();
    if (brandId) next.set("brand", brandId);
    if (status) next.set("status", status);
    setSearchParams(next, { replace: false });
  };
  const backToBrands = () => setSearchParams(new URLSearchParams(), { replace: false });

  // ============================================================
  // BRAND GRID MODE
  // ============================================================
  if (!inDetail) {
    return (
      <div className="space-y-6 p-6 max-w-full overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Button variant="ghost" size="sm" onClick={() => navigate("/decisions")} className="text-pd-accent">
              <ArrowLeft className="h-4 w-4 mr-2" /> Decisions
            </Button>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Gauge className="h-6 w-6 text-pd-accent" /> LSA Calibration
            </h1>
            <p className="text-sm text-muted-foreground">
              Pick a brand to review and update its Low Stock Alerts. Click any number to drill straight into that bucket.
              {brandSummary[0]?.refreshed_at && (
                <span className="ml-2 text-xs">
                  · Summary refreshed {new Date(brandSummary[0].refreshed_at).toLocaleString("en-GB")}
                </span>
              )}
            </p>
          </div>
          <Button variant="outline" onClick={refreshSummary} disabled={isRefetching}>
            {isRefetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh summary
          </Button>
        </div>

        {/* Percentage on target — headline (all brands) */}
        <Card className="border-pd-accent/40 bg-pd-accent/5">
          <CardContent className="py-4 flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <div className="text-4xl font-bold text-pd-accent tabular-nums">{totalsPot == null ? "—" : `${totalsPot}%`}</div>
              <div className="text-sm text-muted-foreground">On target — {totals.target.toLocaleString()} of {totals.active_total.toLocaleString()} actively-managed SKUs (all brands)</div>
            </div>
            <div className="text-xs text-muted-foreground text-right">
              {totals.dormant.toLocaleString()} dormant (no demand, at floor) excluded<br />{totals.total.toLocaleString()} total in scope
            </div>
          </CardContent>
        </Card>

        {/* Totals across all brands */}
        <div className="grid gap-3 md:grid-cols-6">
          {[...ALL_STATUSES, "dormant"].map((s) => {
            const denom = s === "dormant" ? totals.total : totals.active_total;
            return (
            <Card key={s}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{STATUS_META[s].label}</CardTitle>
                <Badge variant="outline" className={STATUS_META[s].cls}>{(totals as any)[s].toLocaleString()}</Badge>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground flex items-center justify-between">
                <span className="tabular-nums">{pct((totals as any)[s], denom)}</span>
                <span>across all brands</span>
              </CardContent>
            </Card>
            );
          })}
        </div>

        {/* Brand search */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative flex-1 min-w-[240px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search brand..."
                  value={brandSearch}
                  onChange={(e) => setBrandSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="ml-auto text-sm text-muted-foreground">
                {filteredBrands.length} of {brandSummary.length} brand{brandSummary.length === 1 ? "" : "s"} ·{" "}
                {totals.total.toLocaleString()} SKUs in scope
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Brand grid */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Brand</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Critical</TableHead>
                    <TableHead className="text-right">Low</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">POT</TableHead>
                    <TableHead className="text-right">High</TableHead>
                    <TableHead className="text-right">Excess</TableHead>
                    <TableHead className="text-right text-muted-foreground">Dormant</TableHead>
                    <TableHead className="w-[140px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brandsLoading ? (
                    <TableRow><TableCell colSpan={10} className="p-0">
                      <PageLoader rows={6} columns={[160, 60, 60, 60, 60, 60, 60, 60, 60, 80]} label="Loading brands" />
                    </TableCell></TableRow>
                  ) : filteredBrands.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                      No brands match your search.
                    </TableCell></TableRow>
                  ) : (
                    filteredBrands.map((b) => {
                      const brandKey = b.brand_id ?? "__none__";
                      const StatusCell = ({ status, value }: { status: StatusKey; value: number }) => (
                        <TableCell className="text-right tabular-nums">
                          {value > 0 ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-auto px-2 py-1 ${STATUS_META[status].cls}`}
                              onClick={() => goToBrand(b.brand_id, status)}
                              disabled={!b.brand_id}
                            >
                              {value.toLocaleString()}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                      );
                      return (
                        <TableRow key={brandKey}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              {b.brand_name || <span className="text-muted-foreground italic">Unmapped</span>}
                              {b.brand_id && autoBrandIds.has(b.brand_id) && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Zap className="h-3.5 w-3.5 text-warning fill-warning" />
                                    </TooltipTrigger>
                                    <TooltipContent>Auto-Update LSA enabled</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{b.total.toLocaleString()}</TableCell>
                          <StatusCell status="critical" value={b.critical} />
                          <StatusCell status="low"      value={b.low} />
                          <StatusCell status="target"   value={b.target} />
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {(() => { const denom = b.active_total ?? (b.total - (b.dormant ?? 0)); return denom > 0 ? `${Math.round((b.target / denom) * 100)}%` : "—"; })()}
                          </TableCell>
                          <StatusCell status="high"     value={b.high} />
                          <StatusCell status="excess"   value={b.excess} />
                          <TableCell className="text-right tabular-nums text-muted-foreground" title="No demand in window, at the LSA floor — nothing to do (dead/liquidation candidates). Excluded from POT.">
                            {(b.dormant ?? 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => goToBrand(b.brand_id)}
                              disabled={!b.brand_id}
                            >
                              Open all →
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============================================================
  // DETAIL MODE (single brand)
  // ============================================================
  return (
    <div className="space-y-6 p-6 max-w-full overflow-hidden">
      {/* Top row: back link (left) + actions (right) */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <Button variant="ghost" size="sm" onClick={backToBrands} className="text-pd-accent -ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to brands
        </Button>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={resetProposed} disabled={Object.keys(proposed).length === 0}>
            Reset proposals
          </Button>
          <Button variant="outline" onClick={applyTargetToFiltered}>
            <Sparkles className="h-4 w-4 mr-2" /> Apply target to filtered
          </Button>
          <Button onClick={pushSelectedOrDirty} disabled={updateMintsoft.isPending || (selectedRows.length === 0 && dirtyRows.length === 0)}>
            {updateMintsoft.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Update Mintsoft ({selectedRows.length || dirtyRows.length})
          </Button>
        </div>
      </div>

      {/* Hero: brand name + on-target % (same large size), dormant/scope caption right */}
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[2.75rem] leading-none font-medium text-foreground inline-flex items-center gap-2">
            {detailBrandName}
            <TooltipProvider><Tooltip>
              <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground self-center" /></TooltipTrigger>
              <TooltipContent className="max-w-xs">Compare current Low Stock Alerts to target (weekly velocity × base multiplier) and push corrections back to Mintsoft.</TooltipContent>
            </Tooltip></TooltipProvider>
          </span>
          <span className="text-[2.75rem] leading-none font-medium text-pd-accent tabular-nums">{detailPot == null ? "—" : `${detailPot}%`}</span>
          <span className="text-sm text-muted-foreground">on target · {(counts.target || 0).toLocaleString()} of {detailActive.toLocaleString()} managed</span>
        </div>
        <div className="text-sm text-muted-foreground text-right">
          {(counts.dormant || 0).toLocaleString()} dormant · {rows.length.toLocaleString()} in scope
        </div>
      </div>

      {/* Segmented distribution bar (scaled to total in scope) — click a band to filter */}
      <div>
        <div className="flex w-full h-3 rounded-full overflow-hidden bg-muted">
          {BAR_BANDS.map(({ key, color }) => {
            const c = counts[key] || 0;
            const w = rows.length > 0 ? (c / rows.length) * 100 : 0;
            if (w <= 0) return null;
            const active = statusFilter === key;
            const dim = statusFilter !== ALL && !active;
            const baseOpacity = key === "dormant" ? 0.4 : 1;
            return (
              <button
                key={key}
                title={`${STATUS_META[key].label}: ${c.toLocaleString()} (${pct(c, rows.length)})`}
                onClick={() => setStatusFilter(active ? ALL : key)}
                style={{ width: `${w}%`, backgroundColor: color, opacity: dim ? baseOpacity * 0.4 : baseOpacity }}
                className="h-full transition-opacity hover:opacity-90"
                aria-label={`Filter by ${STATUS_META[key].label}`}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
          {BAR_BANDS.map(({ key, color }) => {
            const active = statusFilter === key;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(active ? ALL : key)}
                className={`inline-flex items-center gap-1.5 ${active ? "font-semibold text-foreground underline underline-offset-4" : "text-muted-foreground"}`}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color, opacity: key === "dormant" ? 0.4 : 1 }} />
                {STATUS_META[key].label} <span className="tabular-nums">{(counts[key] || 0).toLocaleString()}</span>
              </button>
            );
          })}
        </div>
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
              <Select value={brandParam ?? ALL} onValueChange={(v) => goToBrand(v === ALL ? null : v)}>
                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>← All brands</SelectItem>
                  {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {[...ALL_STATUSES, "dormant"].map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto text-sm text-muted-foreground">
              Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} • {dirtyRows.length} pending change{dirtyRows.length === 1 ? "" : "s"}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {isLoading ? (
        <PageLoader rows={10} columns={[40, 160, 260, 100, 60, 60, 50, 80, 80, 100, 80]} label="Loading SKUs" />
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
                      onCheckedChange={() => {
                        if (allOnPageSelected) {
                          setSelected((prev) => {
                            const next = { ...prev };
                            for (const r of pageRows) delete next[r.sku];
                            return next;
                          });
                        } else {
                          setSelected((prev) => {
                            const next = { ...prev };
                            for (const r of pageRows) next[r.sku] = true;
                            return next;
                          });
                        }
                      }}
                    />
                  </TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Sales/wk</TableHead>
                  <TableHead className="text-right">×Mult</TableHead>
                  <TableHead className="text-right">Target LSA</TableHead>
                  <TableHead className="text-right">Current LSA</TableHead>
                  <TableHead className="text-right w-[120px]">Proposed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                    No SKUs match the current filters.
                  </TableCell></TableRow>
                ) : (
                  pageRows.map((r) => {
                    const meta = STATUS_META[effStatus(r)];
                    const p = proposedFor(r);
                    const dirty = Math.round(p) !== Math.round(r.current_lsa);
                    return (
                      <TableRow key={r.sku} className={dirty ? "bg-pd-accent/5" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={!!selected[r.sku]}
                            onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.sku]: !!v }))}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                        <TableCell className="max-w-[280px] truncate" title={r.product_name || ""}>
                          {r.product_name || <span className="text-muted-foreground italic">—</span>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.brand_name ? r.brand_name : (
                            <span title="No brand mapping — falling back to SKU prefix">{extractPrefix(r.sku)}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.current_stock).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.weekly_velocity).toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{Number(r.base_multiplier).toFixed(1)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{Number(r.target_lsa).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.current_lsa).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            value={p}
                            onChange={(e) =>
                              setProposed((prev) => ({ ...prev, [r.sku]: Number(e.target.value) || 0 }))
                            }
                            className="h-8 w-[100px] text-right tabular-nums ml-auto"
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={meta?.cls}>{meta?.label || r.status}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            {/* Pagination footer */}
            <div className="flex items-center justify-between gap-4 p-3 border-t flex-wrap">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Rows per page</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[90px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[50, 100, 200, 500, 1000].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="ml-2">
                  {filtered.length === 0
                    ? "0 rows"
                    : `${(pageStart + 1).toLocaleString()}–${Math.min(pageStart + pageSize, filtered.length).toLocaleString()} of ${filtered.length.toLocaleString()}`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(1)} disabled={safePage <= 1}>« First</Button>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>‹ Prev</Button>
                <span className="text-sm text-muted-foreground tabular-nums">Page {safePage} of {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>Next ›</Button>
                <Button variant="outline" size="sm" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>Last »</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
};

export default LsaCalibration;
