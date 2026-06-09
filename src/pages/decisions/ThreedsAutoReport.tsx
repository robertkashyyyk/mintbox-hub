import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, AlertTriangle, ChevronLeft, ChevronRight, CalendarClock } from "lucide-react";
import { format } from "date-fns";
import {
  type Tier, type FeeRule, type CostFlag,
  TIER_OPTIONS, TIER_TARGET_POR_PCT, POR_BAND_OPTIONS, BIG_MOVE_MULTIPLE,
  effectiveFeesFor, backSolveGrossPrice, classifyCost, toGross, feeInputsForBackSolve,
} from "@/lib/reprice";

interface AutoCfg {
  enabled?: boolean;
  run_hour_london?: number;
  lookback_days?: number;
  current_band?: string;
  move_to_tier?: Tier;
}
interface SnapRow {
  store_id: string;
  store_name: string | null;
  mintsoft_channel: string | null;
  sku: string;
  base_sku: string | null;
  pack_size: number | null;
  product_name: string | null;
  brand_name: string | null;
  units_sold: number;
  revenue: number | null;
  pack_cost_unit: number | null;
  cost_total: number | null;
  real_fee_rate: number | null;
  courier_total: number | null;
  postage_unit: number | null;
  profit: number | null;
  por_pct: number | null;
  current_price: number | null;
  current_stock: number | null;
}

const PAGE_SIZE = 50;
const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);
const rowKey = (r: { store_id: string; sku: string }) => `${r.store_id}::${r.sku}`;

export default function ThreedsAutoReport() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, { checked: boolean; price?: string }>>({});
  const [page, setPage] = useState(1);

  const { data: cfg } = useQuery({
    queryKey: ["reprice_auto_cfg"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("value").eq("key", "reprice.auto_report").maybeSingle();
      if (error) throw error;
      return (data?.value ?? {}) as AutoCfg;
    },
  });
  const tier: Tier = (cfg?.move_to_tier ?? "average") as Tier;
  const lookback = cfg?.lookback_days ?? 30;
  const bandLabel = POR_BAND_OPTIONS.find((b) => b.value === (cfg?.current_band ?? "loss"))?.label ?? "Loss";

  const { data: feeRules } = useQuery({
    queryKey: ["channel_fee_rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_fee_rules").select("channel_pattern, vat_rate, fee_pct, fixed_fee, priority, active").eq("active", true).order("priority");
      if (error) throw error;
      return data as FeeRule[];
    },
  });

  const { data: snap, isLoading: snapLoading } = useQuery({
    queryKey: ["reprice_auto_snapshot"],
    queryFn: async () => {
      const latest = await supabase
        .from("threeds_reprice_auto_snapshots" as any)
        .select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
      const date = (latest.data as any)?.snapshot_date;
      if (!date) return { date: null as string | null, rows: [] as SnapRow[] };
      const { data, error } = await supabase
        .from("threeds_reprice_auto_snapshots" as any)
        .select("*").eq("snapshot_date", date).order("profit", { ascending: true }).limit(2000);
      if (error) throw error;
      return { date: date as string, rows: (data ?? []) as unknown as SnapRow[] };
    },
  });

  const { data: pending } = useQuery({
    queryKey: ["reprice_auto_pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threeds_reprice_pending" as any).select("store_id, sku, price").eq("status", "pending").limit(5000);
      if (error) throw error;
      return (data ?? []) as unknown as { store_id: string; sku: string; price: number }[];
    },
  });
  const queuedMap = useMemo(() => {
    const m = new Map<string, number>();
    (pending ?? []).forEach((p) => m.set(`${p.store_id}::${p.sku}`, p.price));
    return m;
  }, [pending]);

  type Enriched = SnapRow & { costUnit: number; grossLastSold: number | null; flag: CostFlag; suggestedGross: number | null; targetGross: number | null; atTarget: boolean; usedRealFee: boolean; feePctUsed: number; bigMove: boolean };
  const enriched = useMemo<Enriched[]>(() => {
    const targetPorFrac = TIER_TARGET_POR_PCT[tier] / 100;
    return (snap?.rows ?? []).map((c) => {
      const fees = effectiveFeesFor(c.mintsoft_channel ?? "", feeRules);
      const units = c.units_sold > 0 ? c.units_sold : 0;
      const costUnit = c.pack_cost_unit != null && c.pack_cost_unit > 0 ? c.pack_cost_unit : units > 0 ? (c.cost_total ?? 0) / units : 0;
      const courierUnit = units > 0 ? (c.courier_total ?? 0) / units : 0;
      const grossLastSold = toGross(c.current_price, fees.vat);
      const flag = classifyCost({ costTotal: c.cost_total, unitsSold: units, grossPrice: grossLastSold });
      const { feePct, fixedFeeUnit, usedReal } = feeInputsForBackSolve(c.real_fee_rate, fees);
      const targetGross = flag === null
        ? backSolveGrossPrice({ costUnit, courierUnit, fixedFeeUnit, feePct, vat: fees.vat, targetPorFrac, postageUnit: c.postage_unit ?? 0 })
        : null;
      const atTarget = targetGross != null && grossLastSold != null && targetGross <= grossLastSold;
      const suggestedGross = targetGross == null ? null : grossLastSold != null ? Math.max(targetGross, grossLastSold) : targetGross;
      const bigMove = suggestedGross != null && grossLastSold != null && grossLastSold > 0 && suggestedGross / grossLastSold > BIG_MOVE_MULTIPLE;
      return { ...c, costUnit, grossLastSold, flag, suggestedGross, targetGross, atTarget, usedRealFee: usedReal, feePctUsed: feePct, bigMove };
    });
  }, [snap, feeRules, tier]);

  const matchesSearch = (r: Enriched) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.sku.toLowerCase().includes(q) || (r.product_name ?? "").toLowerCase().includes(q) ||
      (r.brand_name ?? "").toLowerCase().includes(q) || (r.store_name ?? "").toLowerCase().includes(q);
  };
  const repriceable = useMemo(() => enriched.filter((r) => r.flag === null).filter(matchesSearch), [enriched, search]);
  const flaggedCount = useMemo(() => enriched.filter((r) => r.flag !== null).length, [enriched]);

  useEffect(() => { setPage(1); }, [search]);
  const pageCount = Math.max(1, Math.ceil(repriceable.length / PAGE_SIZE));
  const pageRows = useMemo(() => repriceable.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [repriceable, page]);

  const effectivePrice = (r: Enriched): string =>
    selected[rowKey(r)]?.price ?? (r.suggestedGross != null ? r.suggestedGross.toFixed(2) : "");

  // Selected rows grouped by store, for the per-account push split.
  const selectedByStore = useMemo(() => {
    const m = new Map<string, { sku: string; new_price: number }[]>();
    for (const r of repriceable) {
      if (!selected[rowKey(r)]?.checked) continue;
      const price = parseFloat(effectivePrice(r));
      if (isNaN(price) || price <= 0) continue;
      if (!m.has(r.store_id)) m.set(r.store_id, []);
      m.get(r.store_id)!.push({ sku: r.sku, new_price: price });
    }
    return m;
  }, [repriceable, selected]);
  const selectedCount = useMemo(() => { let n = 0; selectedByStore.forEach((v) => (n += v.length)); return n; }, [selectedByStore]);

  const pushMutation = useMutation({
    mutationFn: async () => {
      if (selectedCount === 0) throw new Error("Tick rows first");
      const results: { store: string; ok: boolean; msg: string }[] = [];
      for (const [storeId, rows] of selectedByStore) {
        const { data, error } = await supabase.functions.invoke("threeds-reprice-push", { body: { store_id: storeId, rows } });
        if (error || data?.error) results.push({ store: storeId, ok: false, msg: error?.message ?? data?.error ?? "failed" });
        else results.push({ store: storeId, ok: true, msg: `${data.added} added` });
      }
      return results;
    },
    onSuccess: (results) => {
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      toast({
        title: failed.length === 0 ? "Pushed to 3D" : "Pushed with errors",
        description: `${selectedCount} prices across ${okCount}/${results.length} accounts.${failed.length ? ` Failed: ${failed.length}.` : ""}`,
        variant: failed.length ? "destructive" : undefined,
      });
      setSelected({});
      qc.invalidateQueries({ queryKey: ["reprice_auto_pending"] });
    },
    onError: (e: Error) => toast({ title: "Push failed", description: e.message, variant: "destructive" }),
  });

  const toggleAll = (checked: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const r of pageRows) {
        if (queuedMap.has(rowKey(r))) continue;
        if (checked) next[rowKey(r)] = { checked: true, price: prev[rowKey(r)]?.price };
        else delete next[rowKey(r)];
      }
      return next;
    });
  };
  const selectablePageRows = pageRows.filter((r) => !queuedMap.has(rowKey(r)));
  const allChecked = selectablePageRows.length > 0 && selectablePageRows.every((r) => selected[rowKey(r)]?.checked);

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between flex-wrap gap-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-pd-accent" />
            Auto-Report — all accounts
            <Badge variant="outline" className="text-[10px]">{bandLabel} → {TIER_OPTIONS.find((t) => t.value === tier)?.label}</Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {snap?.date ? <>Snapshot <strong>{format(new Date(snap.date), "dd MMM yyyy")}</strong> · </> : null}
            {repriceable.length} repriceable · {selectedCount} selected{selectedByStore.size > 0 ? ` across ${selectedByStore.size} accounts` : ""}
            {flaggedCount > 0 ? ` · ${flaggedCount} excluded (missing cost)` : ""}. Locked to settings ({bandLabel}, {lookback}d).
            Push splits rows back to each account's file.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU / brand / account" className="w-[240px]" />
          <Button onClick={() => pushMutation.mutate()} disabled={pushMutation.isPending || selectedCount === 0}>
            {pushMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Pushing…</> : <><Upload className="h-4 w-4 mr-2" /> Push {selectedCount} to 3D</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {snapLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !snap?.date ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No snapshot yet — the daily run hasn't produced one. It builds each morning, or trigger it manually.</div>
        ) : repriceable.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No repriceable {bandLabel.toLowerCase()} items in today's snapshot.</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox checked={allChecked} onCheckedChange={(v) => toggleAll(!!v)} /></TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-center">Pack</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">PoR%</TableHead>
                  <TableHead className="text-right">Cost ea</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead className="text-right">Last Sold £<br /><span className="text-[10px] font-normal text-muted-foreground">inc VAT</span></TableHead>
                  <TableHead className="text-right w-[120px]">New £<br /><span className="text-[10px] font-normal text-muted-foreground">inc VAT</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => {
                  const k = rowKey(r);
                  const sel = selected[k];
                  const negative = (r.profit ?? 0) < 0;
                  const queued = queuedMap.has(k);
                  return (
                    <TableRow key={k} className={negative ? "bg-destructive/5" : ""}>
                      <TableCell><Checkbox checked={!!sel?.checked} disabled={queued} onCheckedChange={(v) => setSelected((p) => ({ ...p, [k]: { checked: !!v, price: p[k]?.price } }))} /></TableCell>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell>{r.brand_name ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.store_name ?? "—"}</TableCell>
                      <TableCell className="text-center">{(r.pack_size ?? 1) > 1 ? <Badge variant="secondary" className="font-mono text-[10px]">{r.pack_size}-pack</Badge> : <span className="text-muted-foreground text-xs">single</span>}</TableCell>
                      <TableCell className="text-right">{r.units_sold}</TableCell>
                      <TableCell className={`text-right font-medium ${negative ? "text-destructive" : ""}`}>{gbp(r.profit)}</TableCell>
                      <TableCell className="text-right">{pct(r.por_pct)}</TableCell>
                      <TableCell className="text-right">{gbp(r.costUnit)}</TableCell>
                      <TableCell className="text-right">{pct(r.feePctUsed * 100)}{r.usedRealFee ? "" : "*"}</TableCell>
                      <TableCell className="text-right">{gbp(r.grossLastSold)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <Input type="number" step="0.01" min="0" className={`h-8 w-24 text-right ml-auto ${r.bigMove ? "border-warning" : ""}`} value={effectivePrice(r)} disabled={queued}
                            onChange={(e) => setSelected((p) => ({ ...p, [k]: { checked: p[k]?.checked ?? false, price: e.target.value } }))} placeholder={r.suggestedGross?.toFixed(2) ?? ""} />
                          {queued ? (
                            <Badge variant="secondary" className="border-pd-accent/60 bg-pd-accent/15 text-pd-accent text-[10px] whitespace-nowrap">✓ queued {gbp(queuedMap.get(k))}</Badge>
                          ) : r.atTarget ? (
                            <Badge variant="secondary" className="border-pd-accent/50 bg-pd-accent/10 text-pd-accent text-[10px] whitespace-nowrap">✓ on target</Badge>
                          ) : r.bigMove && r.grossLastSold && r.suggestedGross ? (
                            <Badge variant="secondary" className="border-warning/70 bg-warning/20 text-warning text-[10px] whitespace-nowrap"><AlertTriangle className="h-3 w-3 mr-1" />{(r.suggestedGross / r.grossLastSold).toFixed(1)}× — review</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
  );
}
