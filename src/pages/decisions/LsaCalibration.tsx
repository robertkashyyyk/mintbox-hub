import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { ArrowLeft, Gauge, Loader2, Search, Sparkles } from "lucide-react";
import { useLsaCalibration, type LsaCalibrationRow } from "@/hooks/useLsaCalibration";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const ALL = "__all__";
const ALL_STATUSES = ["critical", "low", "target", "high", "excess"] as const;
type StatusKey = (typeof ALL_STATUSES)[number];

const STATUS_META: Record<StatusKey, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "bg-destructive/15 text-destructive border-destructive/40" },
  low:      { label: "Low",      cls: "bg-warning/15 text-warning border-warning/40" },
  target:   { label: "Target",   cls: "bg-pd-accent/15 text-pd-accent border-pd-accent/40" },
  high:     { label: "High",     cls: "bg-warning/10 text-warning border-warning/30" },
  excess:   { label: "Excess",   cls: "bg-destructive/10 text-destructive border-destructive/30" },
};

const LsaCalibration = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useLsaCalibration();

  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [proposed, setProposed] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const brands = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.brand_id && r.brand_name) m.set(r.brand_id, r.brand_name);
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (brandFilter !== ALL && r.brand_id !== brandFilter) return false;
      if (statusFilter !== ALL && r.status !== statusFilter) return false;
      if (q && !(r.sku.toLowerCase().includes(q) || (r.product_name || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, brandFilter, statusFilter]);

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
    const c: Record<StatusKey, number> = { critical: 0, low: 0, target: 0, high: 0, excess: 0 };
    for (const r of rows) c[r.status as StatusKey] = (c[r.status as StatusKey] || 0) + 1;
    return c;
  }, [rows]);

  const extractPrefix = (sku: string) => {
    if (!sku) return "—";
    const sep = sku.includes("/") ? "/" : "-";
    const head = sku.split(sep)[0];
    return head ? head.toUpperCase() : sku;
  };

  // Seed Proposed from the calculated Target LSA (fall back to current if target missing)
  const proposedFor = (r: LsaCalibrationRow) =>
    proposed[r.sku] ?? Math.round(Number(r.target_lsa) || Number(r.current_lsa) || 0);

  const dirtyRows = useMemo(
    () => filtered.filter((r) => Math.round(proposedFor(r)) !== Math.round(r.current_lsa)),
    [filtered, proposed]
  );

  const allOnPageSelected = filtered.length > 0 && filtered.every((r) => selected[r.sku]);

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
        .select("sku, mintsoft_product_id")
        .in("sku", skus);
      if (pErr) throw pErr;
      const idMap = new Map((products || []).map((p: any) => [p.sku, p.mintsoft_product_id]));
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
    onSuccess: (res) => {
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

  const pushSelectedOrDirty = () => {
    const selectedDirty = dirtyRows.filter((r) => selected[r.sku]);
    const target = selectedDirty.length > 0 ? selectedDirty : dirtyRows;
    if (!target.length) {
      toast({ title: "Nothing to push", description: "No proposed changes detected.", variant: "destructive" });
      return;
    }
    updateMintsoft.mutate(target);
  };

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
            Compare current Low Stock Alerts to target (weekly velocity × base multiplier) and push corrections back to Mintsoft.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={resetProposed} disabled={Object.keys(proposed).length === 0}>
            Reset proposals
          </Button>
          <Button variant="outline" onClick={applyTargetToFiltered}>
            <Sparkles className="h-4 w-4 mr-2" /> Apply Target to filtered
          </Button>
          <Button onClick={pushSelectedOrDirty} disabled={updateMintsoft.isPending || dirtyRows.length === 0}>
            {updateMintsoft.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Update Mintsoft ({dirtyRows.filter((r) => selected[r.sku]).length || dirtyRows.length})
          </Button>
        </div>
      </div>

      {/* Status summary */}
      <div className="grid gap-3 md:grid-cols-5">
        {ALL_STATUSES.map((s) => (
          <Card key={s} className={statusFilter === s ? "ring-1 ring-pd-accent" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{STATUS_META[s].label}</CardTitle>
              <Badge variant="outline" className={STATUS_META[s].cls}>{counts[s].toLocaleString()}</Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <Button
                variant="ghost"
                size="sm"
                className="px-0 h-auto text-xs text-muted-foreground"
                onClick={() => setStatusFilter(statusFilter === s ? ALL : s)}
              >
                {statusFilter === s ? "Clear filter" : "Filter"}
              </Button>
            </CardContent>
          </Card>
        ))}
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
                  {ALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
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
                        if (allOnPageSelected) setSelected({});
                        else {
                          const n: Record<string, boolean> = {};
                          for (const r of filtered) n[r.sku] = true;
                          setSelected(n);
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
                {isLoading ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                    No SKUs match the current filters.
                  </TableCell></TableRow>
                ) : (
                  filtered.map((r) => {
                    const meta = STATUS_META[r.status as StatusKey];
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
            {filtered.length > 1000 && (
              <div className="p-3 text-center text-xs text-muted-foreground border-t">
                Rendering {filtered.length.toLocaleString()} rows — narrow filters if the page feels sluggish.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LsaCalibration;
