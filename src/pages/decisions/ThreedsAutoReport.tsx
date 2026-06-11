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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, Loader2, AlertTriangle, ChevronLeft, ChevronRight, CalendarClock,
  ArrowUp, ArrowDown, ArrowUpDown, TrendingUp, EyeOff, Pencil, RotateCcw,
} from "lucide-react";
import { format } from "date-fns";
import {
  type Tier, type FeeRule, type CostFlag,
  TIER_OPTIONS, TIER_TARGET_POR_PCT, POR_BAND_OPTIONS, BIG_MOVE_MULTIPLE,
  effectiveFeesFor, backSolveGrossPrice, classifyCost, toGross, feeInputsForBackSolve,
} from "@/lib/reprice";

interface AutoCfg {
  enabled?: boolean; run_hour_london?: number; lookback_days?: number; current_band?: string; move_to_tier?: Tier;
}
interface SnapRow {
  store_id: string; store_name: string | null; mintsoft_channel: string | null;
  sku: string; base_sku: string | null; pack_size: number | null; product_name: string | null; brand_name: string | null;
  units_sold: number; revenue: number | null; base_unit_cost: number | null; pack_cost_unit: number | null; cost_total: number | null;
  real_fee_rate: number | null; courier_total: number | null; postage_unit: number | null;
  profit: number | null; por_pct: number | null; current_price: number | null; current_stock: number | null;
}

const PAGE_SIZE = 50;
const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);
const rowKey = (r: { store_id: string; sku: string }) => `${r.store_id}::${r.sku}`;

type SortKey = "sku" | "brand_name" | "store_name" | "units_sold" | "profit" | "por_pct" | "costUnit" | "feePctUsed" | "grossLastSold" | "suggestedGross";

export default function ThreedsAutoReport() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<"all" | "review" | "normal">("all");
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Record<string, { checked: boolean; price?: string }>>({});
  const [page, setPage] = useState(1);
  const [fixCostRow, setFixCostRow] = useState<{ store_id: string; sku: string; base_sku: string | null; base_unit_cost: number | null } | null>(null);
  const [fixCostValue, setFixCostValue] = useState("");
  const [fixedSession, setFixedSession] = useState<Set<string>>(new Set()); // rows fixed this session — hide locally

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
        .select("*").eq("snapshot_date", date).order("profit", { ascending: true }).limit(3000);
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

  const { data: ignored } = useQuery({
    queryKey: ["reprice_auto_ignored"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threeds_reprice_ignored" as any)
        .select("id, store_id, sku, base_sku, reason, cost_at_flag, snooze_days, flagged_at")
        .order("flagged_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; store_id: string; sku: string; base_sku: string | null; reason: string | null; cost_at_flag: number | null; snooze_days: number; flagged_at: string }[];
    },
  });
  const ignoreSet = useMemo(() => new Set((ignored ?? []).map((i) => `${i.store_id}::${i.sku}`)), [ignored]);

  const { data: storesList } = useQuery({
    queryKey: ["threeds_stores_names"],
    queryFn: async () => {
      const { data } = await supabase.from("threeds_stores").select("id, store_name");
      return (data ?? []) as { id: string; store_name: string }[];
    },
  });
  const storeName = (id: string) => storesList?.find((s) => s.id === id)?.store_name ?? "—";

  type Enriched = SnapRow & {
    costUnit: number; grossLastSold: number | null; flag: CostFlag;
    suggestedGross: number | null; targetGross: number | null; atTarget: boolean;
    usedRealFee: boolean; feePctUsed: number; bigMove: boolean;
    projectedProfit: number; currentGMV: number; projectedGMV: number;
  };
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
      // Projected economics: same volume, at the suggested price.
      const S = c.postage_unit ?? 0;
      const projItem = suggestedGross ?? grossLastSold ?? 0;
      const projGmvU = projItem + S;
      const projUnitProfit = projGmvU / (1 + fees.vat) - (fixedFeeUnit + feePct * projGmvU) - courierUnit - costUnit;
      const projectedProfit = projUnitProfit * units;
      const currentGMV = ((c.revenue ?? 0) * (1 + fees.vat)) + S * units; // window-actual item revenue + postage
      const projectedGMV = (projItem + S) * units;
      return { ...c, costUnit, grossLastSold, flag, suggestedGross, targetGross, atTarget, usedRealFee: usedReal, feePctUsed: feePct, bigMove, projectedProfit, currentGMV, projectedGMV };
    });
  }, [snap, feeRules, tier]);

  const repriceableAll = useMemo(
    () => enriched.filter((r) => r.flag === null && !ignoreSet.has(rowKey(r)) && !fixedSession.has(rowKey(r))),
    [enriched, ignoreSet, fixedSession],
  );
  const flaggedCount = useMemo(() => enriched.filter((r) => r.flag !== null).length, [enriched]);

  // Per-brand counts (over all repriceable, before the brand filter, so every brand shows).
  const brandCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of repriceableAll) {
      const b = r.brand_name ?? "—";
      m.set(b, (m.get(b) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [repriceableAll]);

  const matchesSearch = (r: Enriched) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.sku.toLowerCase().includes(q) || (r.product_name ?? "").toLowerCase().includes(q) ||
      (r.brand_name ?? "").toLowerCase().includes(q) || (r.store_name ?? "").toLowerCase().includes(q);
  };

  const filtered = useMemo(() => {
    let rows = repriceableAll;
    if (brandFilter) rows = rows.filter((r) => (r.brand_name ?? "—") === brandFilter);
    if (reviewFilter === "review") rows = rows.filter((r) => r.bigMove);
    else if (reviewFilter === "normal") rows = rows.filter((r) => !r.bigMove);
    rows = rows.filter(matchesSearch);
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (r: Enriched): string | number => {
      const v = (r as any)[sortKey];
      return v == null ? (typeof v === "string" ? "" : -Infinity) : v;
    };
    return [...rows].sort((a, b) => {
      const av = get(a), bv = get(b);
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [repriceableAll, brandFilter, reviewFilter, search, sortKey, sortDir]);

  const reviewCount = useMemo(() => repriceableAll.filter((r) => r.bigMove).length, [repriceableAll]);

  // Impact over the CURRENT view (filtered).
  const impact = useMemo(() => {
    let curProfit = 0, projProfit = 0, curGMV = 0, projGMV = 0;
    for (const r of filtered) { curProfit += r.profit ?? 0; projProfit += r.projectedProfit; curGMV += r.currentGMV; projGMV += r.projectedGMV; }
    return {
      curProfit, projProfit, uplift: projProfit - curProfit,
      porBefore: curGMV > 0 ? (curProfit / curGMV) * 100 : null,
      porAfter: projGMV > 0 ? (projProfit / projGMV) * 100 : null,
      count: filtered.length,
    };
  }, [filtered]);

  useEffect(() => { setPage(1); }, [search, brandFilter, reviewFilter, sortKey, sortDir]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  const effectivePrice = (r: Enriched): string =>
    selected[rowKey(r)]?.price ?? (r.suggestedGross != null ? r.suggestedGross.toFixed(2) : "");

  const selectedByStore = useMemo(() => {
    const m = new Map<string, { sku: string; new_price: number }[]>();
    for (const r of filtered) {
      if (!selected[rowKey(r)]?.checked) continue;
      const price = parseFloat(effectivePrice(r));
      if (isNaN(price) || price <= 0) continue;
      if (!m.has(r.store_id)) m.set(r.store_id, []);
      m.get(r.store_id)!.push({ sku: r.sku, new_price: price });
    }
    return m;
  }, [filtered, selected]);
  const selectedCount = useMemo(() => { let n = 0; selectedByStore.forEach((v) => (n += v.length)); return n; }, [selectedByStore]);

  const pushMutation = useMutation({
    mutationFn: async () => {
      if (selectedCount === 0) throw new Error("Tick rows first");
      const results: { ok: boolean }[] = [];
      for (const [storeId, rows] of selectedByStore) {
        const { data, error } = await supabase.functions.invoke("threeds-reprice-push", { body: { store_id: storeId, rows } });
        results.push({ ok: !(error || data?.error) });
      }
      return results;
    },
    onSuccess: (results) => {
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.length - okCount;
      toast({
        title: failed === 0 ? "Pushed to 3D" : "Pushed with errors",
        description: `${selectedCount} prices across ${okCount}/${results.length} accounts.${failed ? ` Failed: ${failed}.` : ""}`,
        variant: failed ? "destructive" : undefined,
      });
      setSelected({});
      qc.invalidateQueries({ queryKey: ["reprice_auto_pending"] });
    },
    onError: (e: Error) => toast({ title: "Push failed", description: e.message, variant: "destructive" }),
  });

  // Flag a row as ignore/error (cost-aware snooze).
  const flagIgnore = useMutation({
    mutationFn: async (r: Enriched) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("threeds_reprice_ignored" as any).upsert({
        store_id: r.store_id, sku: r.sku, base_sku: r.base_sku, reason: "bad cost / review",
        cost_at_flag: r.base_unit_cost, snooze_days: 14, flagged_by: u?.user?.id ?? null, flagged_at: new Date().toISOString(),
      }, { onConflict: "store_id,sku" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reprice_auto_ignored"] }); toast({ title: "Flagged", description: "Hidden from the list — see the Ignored tab. Returns if the cost isn't corrected." }); },
    onError: (e: Error) => toast({ title: "Flag failed", description: e.message, variant: "destructive" }),
  });

  const unflag = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("threeds_reprice_ignored" as any).delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reprice_auto_ignored"] }); toast({ title: "Un-flagged", description: "Back in the repriceable list." }); },
    onError: (e: Error) => toast({ title: "Un-flag failed", description: e.message, variant: "destructive" }),
  });

  // Fix the base-SKU cost: push to Mintsoft + mirror (reuses update-product-cost).
  const fixCost = useMutation({
    mutationFn: async ({ row, cost }: { row: { store_id: string; sku: string; base_sku: string | null }; cost: number }) => {
      const baseSku = row.base_sku ?? row.sku;
      const { data: pc, error: pcErr } = await supabase.from("products_cache").select("mintsoft_id").eq("sku", baseSku).maybeSingle();
      if (pcErr) throw pcErr;
      const msId = (pc as any)?.mintsoft_id;
      if (!msId) throw new Error(`No Mintsoft ID for ${baseSku}`);
      const { data, error } = await supabase.functions.invoke("update-product-cost", { body: { items: [{ mintsoft_product_id: msId, sku: baseSku, cost_price: cost }] } });
      if (error) throw error;
      const res = (data as any)?.results?.[0];
      if (!res?.ok) throw new Error(res?.error ?? "update failed");
      return row;
    },
    onSuccess: (row) => {
      setFixedSession((s) => new Set(s).add(`${row.store_id}::${row.sku}`)); // hide locally; refreshes next snapshot
      setFixCostRow(null); setFixCostValue("");
      toast({ title: "Cost updated", description: "Pushed to Mintsoft. Row hidden for now — it refreshes with the corrected cost on the next snapshot." });
    },
    onError: (e: Error) => toast({ title: "Cost update failed", description: e.message, variant: "destructive" }),
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

  // Select-all across every page in the current filtered view (not just this page).
  const selectableFiltered = useMemo(() => filtered.filter((r) => !queuedMap.has(rowKey(r))), [filtered, queuedMap]);
  const allFilteredChecked = selectableFiltered.length > 0 && selectableFiltered.every((r) => selected[rowKey(r)]?.checked);
  const selectAllFiltered = () =>
    setSelected((prev) => {
      const next = { ...prev };
      for (const r of selectableFiltered) next[rowKey(r)] = { checked: true, price: prev[rowKey(r)]?.price };
      return next;
    });
  const clearSelection = () => setSelected({});

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "sku" || k === "brand_name" || k === "store_name" ? "asc" : "desc"); }
  };
  const SortHead = ({ k, label, align }: { k: SortKey; label: string; align?: "right" | "center" }) => {
    const active = sortKey === k;
    const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <TableHead className={align === "right" ? "text-right" : align === "center" ? "text-center" : ""}>
        <button type="button" onClick={() => toggleSort(k)}
          className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : "text-foreground/70"} ${align === "right" ? "ml-auto" : ""}`}>
          <span>{label}</span><Icon className="h-3 w-3" />
        </button>
      </TableHead>
    );
  };

  const ignoredList = ignored ?? [];

  return (
    <div className="space-y-4">
    <Tabs defaultValue="repriceable" className="w-full">
      <TabsList>
        <TabsTrigger value="repriceable" className="gap-2">Repriceable <Badge variant="secondary" className="text-[10px]">{repriceableAll.length}</Badge></TabsTrigger>
        <TabsTrigger value="ignored" className="gap-2">Ignored / errors {ignoredList.length > 0 && <Badge variant="secondary" className="text-[10px]">{ignoredList.length}</Badge>}</TabsTrigger>
      </TabsList>

      <TabsContent value="repriceable" className="space-y-4 mt-4">
      {/* Sticky summary + brand + impact cards */}
      <div className="sticky top-0 z-20 bg-background pt-1 pb-2 space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          {/* Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-pd-accent" /> Auto-Report
                <Badge variant="outline" className="text-[10px]">{bandLabel} → {TIER_OPTIONS.find((t) => t.value === tier)?.label}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>{snap?.date ? <>Snapshot <strong>{format(new Date(snap.date), "dd MMM")}</strong> · </> : null}<strong>{repriceableAll.length}</strong> repriceable · {filtered.length} in view</div>
              <div className="text-xs text-muted-foreground">{selectedCount} selected{selectedByStore.size > 0 ? ` (${selectedByStore.size} accounts)` : ""} · {reviewCount} review · {flaggedCount} excluded (missing cost)</div>
            </CardContent>
          </Card>

          {/* Impact */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-pd-accent" /> If you reprice this view</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Now ({lookback}d)</span><span className={impact.curProfit < 0 ? "text-destructive font-medium" : "font-medium"}>{gbp(impact.curProfit)} · {pct(impact.porBefore)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Projected</span><span className="font-medium text-pd-accent">{gbp(impact.projProfit)} · {pct(impact.porAfter)}</span></div>
              <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">Uplift</span><span className="font-semibold">{gbp(impact.uplift)}</span></div>
              <div className="text-[10px] text-muted-foreground">Same volume; doesn't model demand changes.</div>
            </CardContent>
          </Card>

          {/* Brand breakdown (clickable filter) */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">By brand {brandFilter && <Button variant="ghost" size="sm" className="h-5 px-2 text-xs ml-1" onClick={() => setBrandFilter(null)}>clear</Button>}</CardTitle></CardHeader>
            <CardContent className="max-h-28 overflow-y-auto">
              <div className="flex flex-wrap gap-1">
                {brandCounts.map(([b, n]) => (
                  <button key={b} type="button" onClick={() => setBrandFilter((cur) => (cur === b ? null : b))}
                    className={`text-xs px-2 py-0.5 rounded border ${brandFilter === b ? "bg-pd-accent text-white border-pd-accent" : "border-border hover:bg-muted"}`}>
                    {b} <span className="opacity-70">{n}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <ToggleGroup type="single" value={reviewFilter} onValueChange={(v) => v && setReviewFilter(v as any)}>
            <ToggleGroupItem value="all" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white text-xs px-3">All</ToggleGroupItem>
            <ToggleGroupItem value="review" className="data-[state=on]:bg-warning data-[state=on]:text-white text-xs px-3">Review</ToggleGroupItem>
            <ToggleGroupItem value="normal" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white text-xs px-3">Normal</ToggleGroupItem>
          </ToggleGroup>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU / brand / account" className="w-[240px]" />
          <div className="flex-1" />
          <Button onClick={() => pushMutation.mutate()} disabled={pushMutation.isPending || selectedCount === 0}>
            {pushMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Pushing…</> : <><Upload className="h-4 w-4 mr-2" /> Push {selectedCount} to 3D</>}
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {snapLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : !snap?.date ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No snapshot yet — it builds each morning, or use "Build snapshot now" in Settings.</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No rows match the current filters.</div>
          ) : (
            <>
              {(allChecked || allFilteredChecked) && filtered.length > pageRows.length && (
                <div className="flex items-center justify-center gap-2 py-2 text-xs bg-pd-accent/10 border-b text-pd-accent">
                  {allFilteredChecked ? (
                    <>All <strong>{selectableFiltered.length}</strong> items in this view are selected.
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={clearSelection}>Clear selection</Button></>
                  ) : (
                    <>All <strong>{selectablePageRows.length}</strong> on this page selected.
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={selectAllFiltered}>Select all {selectableFiltered.length} items in this view</Button></>
                  )}
                </div>
              )}
              <div className="overflow-auto max-h-[calc(100vh-340px)]">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="w-10"><Checkbox checked={allChecked} onCheckedChange={(v) => toggleAll(!!v)} /></TableHead>
                      <SortHead k="sku" label="SKU" />
                      <SortHead k="brand_name" label="Brand" />
                      <SortHead k="store_name" label="Account" />
                      <TableHead className="text-center">Pack</TableHead>
                      <SortHead k="units_sold" label="Units" align="right" />
                      <SortHead k="profit" label="Profit" align="right" />
                      <SortHead k="por_pct" label="PoR%" align="right" />
                      <SortHead k="costUnit" label="Cost ea" align="right" />
                      <SortHead k="feePctUsed" label="Fee" align="right" />
                      <SortHead k="grossLastSold" label="Last Sold" align="right" />
                      <SortHead k="suggestedGross" label="New £" align="right" />
                      <TableHead className="text-center w-[70px]">Actions</TableHead>
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
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Fix cost (push to Mintsoft)"
                                onClick={() => { setFixCostRow({ store_id: r.store_id, sku: r.sku, base_sku: r.base_sku, base_unit_cost: r.base_unit_cost }); setFixCostValue(r.base_unit_cost != null ? String(r.base_unit_cost) : ""); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-warning" title="Ignore / flag as error (hides until cost corrected)"
                                disabled={flagIgnore.isPending} onClick={() => flagIgnore.mutate(r)}>
                                <EyeOff className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {pageCount > 1 && (
                <div className="flex items-center justify-end gap-2 p-3 text-sm border-t">
                  <span className="text-muted-foreground">Page {page} of {pageCount}</span>
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="ignored" className="mt-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><EyeOff className="h-4 w-4 text-warning" /> Ignored / errors</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Flagged rows are hidden from the repriceable list. Each returns automatically when its cost is corrected, or after its snooze window if still wrong. Un-flag to bring one back now.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {ignoredList.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Nothing flagged.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead><TableHead>Account</TableHead><TableHead>Reason</TableHead>
                    <TableHead className="text-right">Cost when flagged</TableHead><TableHead>Flagged</TableHead><TableHead>Returns by</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ignoredList.map((ig) => {
                    const returns = new Date(new Date(ig.flagged_at).getTime() + (ig.snooze_days ?? 14) * 86_400_000);
                    return (
                      <TableRow key={ig.id}>
                        <TableCell className="font-mono text-xs">{ig.sku}</TableCell>
                        <TableCell className="text-xs">{storeName(ig.store_id)}</TableCell>
                        <TableCell className="text-xs">{ig.reason ?? "—"}</TableCell>
                        <TableCell className="text-right">{gbp(ig.cost_at_flag)}</TableCell>
                        <TableCell className="text-xs">{format(new Date(ig.flagged_at), "dd MMM HH:mm")}</TableCell>
                        <TableCell className="text-xs">{format(returns, "dd MMM")} <span className="text-muted-foreground">(if uncorrected)</span></TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={unflag.isPending} onClick={() => unflag.mutate(ig.id)}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Un-flag
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
      </Tabs>

      {/* Fix-cost dialog */}
      <Dialog open={fixCostRow !== null} onOpenChange={(o) => { if (!o) { setFixCostRow(null); setFixCostValue(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Fix cost — {fixCostRow?.base_sku ?? fixCostRow?.sku}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">New cost price (ex-VAT, per single unit) — pushed to Mintsoft</Label>
            <Input type="number" step="0.01" min="0" value={fixCostValue} onChange={(e) => setFixCostValue(e.target.value)} placeholder="0.00" autoFocus />
            <p className="text-[11px] text-muted-foreground">Updates the base SKU's cost in Mintsoft + the catalogue. The row hides until the next snapshot picks up the corrected cost.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFixCostRow(null); setFixCostValue(""); }}>Cancel</Button>
            <Button disabled={fixCost.isPending || !(parseFloat(fixCostValue) > 0)}
              onClick={() => fixCostRow && fixCost.mutate({ row: fixCostRow, cost: parseFloat(fixCostValue) })}>
              {fixCost.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Push to Mintsoft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
