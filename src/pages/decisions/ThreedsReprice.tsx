import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Loader2, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight, Flame } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import ThreedsAutoReport from "./ThreedsAutoReport";
import { format } from "date-fns";
import {
  type Tier, type FeeRule, type CostFlag,
  TIER_OPTIONS, TIER_TARGET_POR_PCT, SUSPECT_COST_MULTIPLE, BIG_MOVE_MULTIPLE,
  POR_BAND_OPTIONS, classifyPorBand,
  effectiveFeesFor, backSolveGrossPrice, classifyCost, toGross, feeInputsForBackSolve,
} from "@/lib/reprice";

interface Store {
  id: string;
  store_name: string;
  mintsoft_channel: string;
  sftp_filename: string;
  enabled: boolean;
}
interface Candidate {
  sku: string;
  base_sku: string | null;
  pack_size: number | null; // Q-code multiplier (Q0N => N), 1 for singles
  product_name: string | null;
  brand_name: string | null;
  units_sold: number;
  revenue: number | null;
  base_unit_cost: number | null; // products_cache cost of the BASE (single) SKU
  pack_cost_unit: number | null; // base_unit_cost × pack_size (Robert's rule)
  cost_total: number | null;
  real_fee_rate: number | null; // measured VARIABLE eBay rate (~13%) from 3DS, or null
  fees_total: number | null;
  courier_total: number | null;
  postage_unit: number | null; // avg buyer-paid postage per item (income)
  profit: number | null;
  por_pct: number | null;
  current_price: number | null; // NET (ex-VAT) latest sold price
  current_stock: number | null;
}
interface PendingRow {
  sku: string;
  price: number;
  status: string; // pending | applied | expired
  queued_at: string;
  applied_at: string | null;
  verified_price: number | null;
}
interface PushLog {
  id: string;
  pushed_at: string;
  row_count: number;
  status: string;
  sftp_path: string | null;
  error_message: string | null;
}

/** Candidate enriched with per-unit economics + the gross prices we actually use. */
interface EnrichedRow extends Candidate {
  costUnit: number;
  grossLastSold: number | null; // current_price grossed up (what eBay shows)
  flag: CostFlag;
  suggestedGross: number | null; // price we propose (floored at current — never a drop)
  targetGross: number | null; // raw back-solved price for the tier (may be below current)
  atTarget: boolean; // current price already meets/exceeds the chosen tier
  feePctUsed: number; // fee rate the back-solve used (real or modeled)
  usedRealFee: boolean; // true when the measured 3DS fee rate was used
  bigMove: boolean; // suggested price is a large multiple of current → review
}

const PAGE_SIZE = 50;

const gbp = (n: number | null | undefined) =>
  n == null ? "—" :
    new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toFixed(1)}%`;

function Pager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-3 text-sm">
      <span className="text-muted-foreground">Page {page} of {pageCount}</span>
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function ThreedsReprice() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [storeId, setStoreId] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [search, setSearch] = useState("");
  const [currentBand, setCurrentBand] = useState<string>("all"); // filter by CURRENT por band
  const [tier, setTier] = useState<Tier>("breakeven");
  const [selected, setSelected] = useState<Record<string, { checked: boolean; price?: string }>>({});
  const [page, setPage] = useState(1);
  const [flagPage, setFlagPage] = useState(1);

  const { data: stores, isLoading: storesLoading } = useQuery({
    queryKey: ["threeds_stores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threeds_stores")
        .select("*")
        .order("store_name");
      if (error) throw error;
      return data as Store[];
    },
  });

  const { data: feeRules } = useQuery({
    queryKey: ["channel_fee_rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_fee_rules")
        .select("channel_pattern, vat_rate, fee_pct, fixed_fee, priority, active")
        .eq("active", true)
        .order("priority");
      if (error) throw error;
      return data as FeeRule[];
    },
  });

  const activeStore = stores?.find((s) => s.id === storeId) ?? null;

  const fees = useMemo(
    () => effectiveFeesFor(activeStore?.mintsoft_channel ?? "", feeRules),
    [activeStore?.mintsoft_channel, feeRules],
  );

  const { data: candidates, isLoading: candLoading, isFetching: candFetching, refetch } = useQuery({
    queryKey: ["threeds_candidates", activeStore?.mintsoft_channel, days],
    enabled: !!activeStore,
    queryFn: async () => {
      // Ring-fence is enforced inside the RPC (excludes active-campaign SKUs).
      const { data, error } = await supabase.rpc("get_threeds_reprice_candidates", {
        p_channel: activeStore!.mintsoft_channel,
        p_days: days,
      });
      if (error) throw error;
      return (data ?? []) as Candidate[];
    },
  });

  // Awareness: how many SKUs are currently ring-fenced under an active campaign.
  const { data: fencedCount = 0 } = useQuery({
    queryKey: ["active-campaign-count"],
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("price_campaigns").select("id", { count: "exact", head: true }).eq("status", "active");
      return count ?? 0;
    },
  });

  const { data: pendingQueue } = useQuery({
    queryKey: ["threeds_pending", storeId],
    enabled: !!storeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threeds_reprice_pending" as any)
        .select("sku, price, status, queued_at, applied_at, verified_price")
        .eq("store_id", storeId!)
        .order("status", { ascending: true })
        .order("queued_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as PendingRow[];
    },
  });
  const pendingCount = (pendingQueue ?? []).filter((p) => p.status === "pending").length;
  // Map of SKU → queued price for rows already sitting in the pending file.
  // Pending (in the file) OR applied (gone live) within 14 days → "already repriced".
  const queuedMap = useMemo(() => {
    const m = new Map<string, { price: number; status: string }>();
    const since = Date.now() - 14 * 86_400_000;
    (pendingQueue ?? []).forEach((p) => {
      if (p.status === "pending" || (p.status === "applied" && p.applied_at && new Date(p.applied_at).getTime() >= since)) {
        m.set(p.sku, { price: p.price, status: p.status });
      }
    });
    return m;
  }, [pendingQueue]);

  const { data: pushes } = useQuery({
    queryKey: ["threeds_pushes", storeId],
    enabled: !!storeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threeds_reprice_pushes")
        .select("id, pushed_at, row_count, status, sftp_path, error_message")
        .eq("store_id", storeId!)
        .order("pushed_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as PushLog[];
    },
  });

  // Enrich every candidate with per-unit economics, cost flag and a back-solved
  // gross price for the chosen tier.
  const enriched = useMemo<EnrichedRow[]>(() => {
    const targetPorFrac = TIER_TARGET_POR_PCT[tier] / 100;
    return (candidates ?? []).map((c) => {
      const units = c.units_sold > 0 ? c.units_sold : 0;
      // Pack-aware cost: prefer the derived pack_cost_unit (base unit cost ×
      // pack_size) from the RPC; fall back to cost_total/units for safety.
      const costUnit =
        c.pack_cost_unit != null && c.pack_cost_unit > 0
          ? c.pack_cost_unit
          : units > 0 ? (c.cost_total ?? 0) / units : 0;
      const courierUnit = units > 0 ? (c.courier_total ?? 0) / units : 0;
      const grossLastSold = toGross(c.current_price, fees.vat);
      // Flag on the pack-aware cost: cost_total from the RPC is already
      // pack_cost_unit × units (NULL when the base cost is missing).
      const flag = classifyCost({ costTotal: c.cost_total, unitsSold: units, grossPrice: grossLastSold });
      // Prefer the measured real eBay fee rate (~22%) over the modeled default.
      const { feePct, fixedFeeUnit, usedReal } = feeInputsForBackSolve(c.real_fee_rate, fees);
      const targetGross =
        flag === null
          ? backSolveGrossPrice({
              costUnit,
              courierUnit,
              fixedFeeUnit,
              feePct,
              vat: fees.vat,
              targetPorFrac,
              postageUnit: c.postage_unit ?? 0,
            })
          : null;
      // Profit tool: only ever propose a RAISE. If the item already meets the
      // chosen tier (target ≤ current), don't suggest a drop — hold at current.
      const atTarget =
        targetGross != null && grossLastSold != null && targetGross <= grossLastSold;
      const suggestedGross =
        targetGross == null ? null : grossLastSold != null ? Math.max(targetGross, grossLastSold) : targetGross;
      const bigMove =
        suggestedGross != null && grossLastSold != null && grossLastSold > 0 &&
        suggestedGross / grossLastSold > BIG_MOVE_MULTIPLE;
      return { ...c, costUnit, grossLastSold, flag, suggestedGross, targetGross, atTarget, feePctUsed: feePct, usedRealFee: usedReal, bigMove };
    });
  }, [candidates, tier, fees]);

  const matchesSearch = (r: EnrichedRow) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.sku.toLowerCase().includes(q) ||
      (r.product_name ?? "").toLowerCase().includes(q) ||
      (r.brand_name ?? "").toLowerCase().includes(q)
    );
  };

  const repriceable = useMemo(() => {
    let rows = enriched.filter((r) => r.flag === null);
    if (currentBand !== "all") rows = rows.filter((r) => classifyPorBand(r.por_pct) === currentBand);
    return rows.filter(matchesSearch);
  }, [enriched, currentBand, search]);

  const flagged = useMemo(
    () => enriched.filter((r) => r.flag !== null).filter(matchesSearch),
    [enriched, search],
  );

  const missingCount = useMemo(() => enriched.filter((r) => r.flag === "missing_cost").length, [enriched]);
  const suspectCount = useMemo(() => enriched.filter((r) => r.flag === "suspect_cost").length, [enriched]);
  const bigMoveCount = useMemo(() => repriceable.filter((r) => r.bigMove).length, [repriceable]);

  // Reset pagination + selection when the working set changes.
  useEffect(() => { setPage(1); }, [search, currentBand, tier, storeId, days]);
  useEffect(() => { setFlagPage(1); }, [search, storeId, days]);
  useEffect(() => { setSelected({}); }, [storeId, days]);

  const pageCount = Math.max(1, Math.ceil(repriceable.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => repriceable.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [repriceable, page],
  );
  const flagPageCount = Math.max(1, Math.ceil(flagged.length / PAGE_SIZE));
  const flagPageRows = useMemo(
    () => flagged.slice((flagPage - 1) * PAGE_SIZE, flagPage * PAGE_SIZE),
    [flagged, flagPage],
  );

  // Effective price for a row = user override, else the tier suggestion.
  const effectivePrice = (r: EnrichedRow): string =>
    selected[r.sku]?.price ?? (r.suggestedGross != null ? r.suggestedGross.toFixed(2) : "");

  const selectedRows = useMemo(() => {
    return repriceable
      .filter((r) => selected[r.sku]?.checked)
      .map((r) => ({ sku: r.sku, new_price: parseFloat(effectivePrice(r)) }))
      .filter((r) => !isNaN(r.new_price) && r.new_price > 0);
  }, [repriceable, selected]);

  const pushMutation = useMutation({
    mutationFn: async () => {
      if (!storeId) throw new Error("No store selected");
      if (selectedRows.length === 0) throw new Error("Tick rows and enter prices first");
      const { data, error } = await supabase.functions.invoke("threeds-reprice-push", {
        body: { store_id: storeId, rows: selectedRows },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Pushed to 3D",
        description: `Added ${data.added} — file now holds ${data.row_count} pending price${data.row_count === 1 ? "" : "s"} (${data.sftp_path}). Cleared nightly once confirmed live.`,
      });
      setSelected({});
      qc.invalidateQueries({ queryKey: ["threeds_pushes", storeId] });
      qc.invalidateQueries({ queryKey: ["threeds_pending", storeId] });
    },
    onError: (e: Error) => {
      toast({ title: "Push failed", description: e.message, variant: "destructive" });
    },
  });

  // Select / clear all rows on the CURRENT page only.
  const toggleAll = (checked: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const r of pageRows) {
        if (queuedMap.has(r.sku)) continue; // skip rows already in the pending queue
        if (checked) next[r.sku] = { checked: true, price: prev[r.sku]?.price };
        else delete next[r.sku];
      }
      return next;
    });
  };
  const selectablePageRows = pageRows.filter((r) => !queuedMap.has(r.sku));
  const allChecked = selectablePageRows.length > 0 && selectablePageRows.every((r) => selected[r.sku]?.checked);

  const flagBadge = (f: CostFlag) =>
    f === "missing_cost" ? (
      <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />missing cost</Badge>
    ) : f === "suspect_cost" ? (
      <Badge variant="secondary" className="border-warning/70 bg-warning/20 text-warning">
        <AlertTriangle className="h-3 w-3 mr-1" />suspect cost
      </Badge>
    ) : null;

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="text-pd-accent hover:text-pd-accent-light mb-2"
          onClick={() => navigate("/decisions")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Decisions
        </Button>
        <ModuleHeader
          title="3D Reprice"
          description="Pick a store, choose the profitability tier to move prices to, review the suggested inc-VAT price, then push to 3D via SFTP."
          icon={RefreshCw}
        />
      </div>

      {fencedCount > 0 && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-400 flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 flex-shrink-0" />
          {fencedCount} SKU{fencedCount === 1 ? "" : "s"} ring-fenced under an active price campaign — excluded from repricing.{" "}
          <a href="/decisions/liquidation" className="underline">View campaigns</a>
        </div>
      )}

      <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as "manual" | "auto")} className="justify-start">
        <ToggleGroupItem value="manual" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white px-4">Semi-Manual</ToggleGroupItem>
        <ToggleGroupItem value="auto" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white px-4">Auto-Report</ToggleGroupItem>
      </ToggleGroup>

      {mode === "auto" && <ThreedsAutoReport />}

      {mode === "manual" && (
      <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Store & window</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Store (channel)</label>
            <Select value={storeId ?? ""} onValueChange={setStoreId}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder={storesLoading ? "Loading…" : "Pick a store"} />
              </SelectTrigger>
              <SelectContent>
                {stores?.map((s) => (
                  <SelectItem key={s.id} value={s.id} disabled={!s.enabled}>
                    {s.store_name} <span className="text-muted-foreground">— {s.mintsoft_channel}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Look-back</label>
            <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
                <SelectItem value="180">180 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Current band</label>
            <Select value={currentBand} onValueChange={setCurrentBand}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All bands</SelectItem>
                {POR_BAND_OPTIONS.map((b) => (
                  <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Move prices to</label>
            <Select value={tier} onValueChange={(v) => setTier(v as Tier)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIER_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Search SKU / brand / name</label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. NGK-05747" />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={!activeStore}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      {activeStore && (
      <Tabs defaultValue="repriceable" className="w-full">
        <TabsList>
          <TabsTrigger value="repriceable" className="gap-2">
            Repriceable
            {candFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Badge variant="secondary" className="text-[10px]">{repriceable.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="flagged" className="gap-2">
            Flagged
            {flagged.length > 0 && <Badge variant="secondary" className="text-[10px]">{flagged.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            Pending queue
            {pendingCount > 0 && <Badge variant="secondary" className="text-[10px]">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pushes">Recent pushes</TabsTrigger>
        </TabsList>

        <TabsContent value="repriceable">
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {repriceable.length} repriceable · {selectedRows.length} selected
                {pendingCount > 0 && <span className="text-xs font-normal text-pd-accent">· {pendingCount} queued</span>}
                {candFetching && <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> loading…</span>}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {currentBand !== "all" && (
                  <>Showing <strong>{POR_BAND_OPTIONS.find((b) => b.value === currentBand)?.label}</strong> items → repricing up to{" "}
                  <strong>{TIER_OPTIONS.find((t) => t.value === tier)?.label}</strong>. </>
                )}
                New price targets the <strong>{TIER_OPTIONS.find((t) => t.value === tier)?.label}</strong> band
                ({pct(TIER_TARGET_POR_PCT[tier])} POR) and is shown <strong>inc VAT</strong> ({Math.round(fees.vat * 100)}%).
                Uses each listing's <strong>real variable eBay fee</strong> (from 3DS) + {gbp(fees.fixedFee)} fixed,
                counts <strong>buyer-paid postage as income</strong>, and pack SKUs (-Q0N) cost = single-unit cost × pack size.
                {bigMoveCount > 0 && (
                  <> · <span className="text-warning font-medium">{bigMoveCount} big move{bigMoveCount === 1 ? "" : "s"}</span> (&gt;{BIG_MOVE_MULTIPLE}× current) flagged for review.</>
                )}
              </p>
            </div>
            <Button
              onClick={() => pushMutation.mutate()}
              disabled={pushMutation.isPending || candFetching || selectedRows.length === 0}
            >
              {pushMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Pushing…</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" /> Push {selectedRows.length} to 3D</>
              )}
            </Button>
          </CardHeader>
          <CardContent className={`overflow-x-auto transition-opacity ${candFetching ? "pointer-events-none opacity-50" : ""}`}>
            {candLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : repriceable.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No repriceable SKUs for this store / window / filter.
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox checked={allChecked} onCheckedChange={(v) => toggleAll(!!v)} />
                      </TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead className="text-center">Pack</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">PoR%</TableHead>
                      <TableHead className="text-right">Cost ea</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead className="text-right">Last Sold £<br /><span className="text-[10px] font-normal text-muted-foreground">inc VAT</span></TableHead>
                      <TableHead className="text-right w-[120px]">New £<br /><span className="text-[10px] font-normal text-muted-foreground">inc VAT</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((r) => {
                      const sel = selected[r.sku];
                      const negative = (r.profit ?? 0) < 0;
                      const defaultPrice = r.suggestedGross != null ? r.suggestedGross.toFixed(2) : "";
                      return (
                        <TableRow key={r.sku} className={negative ? "bg-destructive/5" : ""}>
                          <TableCell>
                            <Checkbox
                              checked={!!sel?.checked}
                              onCheckedChange={(v) =>
                                setSelected((p) => ({
                                  ...p,
                                  [r.sku]: { checked: !!v, price: p[r.sku]?.price },
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                          <TableCell>{r.brand_name ?? "—"}</TableCell>
                          <TableCell className="text-center">
                            {(r.pack_size ?? 1) > 1 ? (
                              <Badge variant="secondary" className="font-mono text-[10px]">{r.pack_size}-pack</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">single</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{r.units_sold}</TableCell>
                          <TableCell className="text-right">{gbp(r.revenue)}</TableCell>
                          <TableCell className={`text-right font-medium ${negative ? "text-destructive" : ""}`}>
                            {gbp(r.profit)}
                          </TableCell>
                          <TableCell className="text-right">{pct(r.por_pct)}</TableCell>
                          <TableCell className="text-right">{gbp(r.costUnit)}</TableCell>
                          <TableCell className="text-right">
                            <span title={r.usedRealFee ? "Real eBay fee from 3DS orders" : "Modeled channel fee (no 3DS data)"}>
                              {pct(r.feePctUsed * 100)}{r.usedRealFee ? "" : "*"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">{r.current_stock ?? "—"}</TableCell>
                          <TableCell className="text-right">{gbp(r.grossLastSold)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end gap-1">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                className={`h-8 w-24 text-right ml-auto ${r.bigMove ? "border-warning" : ""}`}
                                value={effectivePrice(r)}
                                onChange={(e) =>
                                  setSelected((p) => ({
                                    ...p,
                                    [r.sku]: { checked: p[r.sku]?.checked ?? false, price: e.target.value },
                                  }))
                                }
                                placeholder={defaultPrice}
                              />
                              {queuedMap.has(r.sku) ? (
                                <Badge variant="secondary" className="border-pd-accent/60 bg-pd-accent/15 text-pd-accent text-[10px] whitespace-nowrap"
                                  title={queuedMap.get(r.sku)?.status === "applied" ? `Already repriced to ${gbp(queuedMap.get(r.sku)?.price)} and live — give the sales data time to catch up.` : `Queued at ${gbp(queuedMap.get(r.sku)?.price)} — waiting for 3D to import.`}>
                                  {queuedMap.get(r.sku)?.status === "applied" ? "✓ repriced" : "✓ queued"} {gbp(queuedMap.get(r.sku)?.price)}
                                </Badge>
                              ) : r.atTarget ? (
                                <Badge variant="secondary" className="border-pd-accent/50 bg-pd-accent/10 text-pd-accent text-[10px] whitespace-nowrap"
                                  title={`Already ≥ ${TIER_OPTIONS.find((t) => t.value === tier)?.label} (tier target ${gbp(r.targetGross)}). Held at current — no raise needed.`}>
                                  ✓ on target
                                </Badge>
                              ) : r.bigMove && r.grossLastSold && r.suggestedGross ? (
                                <Badge variant="secondary" className="border-warning/70 bg-warning/20 text-warning text-[10px] whitespace-nowrap">
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  {(r.suggestedGross / r.grossLastSold).toFixed(1)}× — review
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <Pager page={page} pageCount={pageCount} onChange={setPage} />
              </>
            )}
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="flagged">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {flagged.length} flagged — fix cost before repricing
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {missingCount} missing cost (zero/blank) · {suspectCount} suspect cost
              (cost/unit &gt; {SUSPECT_COST_MULTIPLE}× the inc-VAT sale price — likely a pack cost on a single listing).
              These are excluded from repricing until the cost is corrected in the catalogue.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {candLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : flagged.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No flagged SKUs — every candidate has a usable cost. 🎉
              </div>
            ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Flag</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Cost ea</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Last Sold £<br /><span className="text-[10px] font-normal text-muted-foreground">inc VAT</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flagPageRows.map((r) => (
                  <TableRow key={r.sku}>
                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                    <TableCell>{r.brand_name ?? "—"}</TableCell>
                    <TableCell>{flagBadge(r.flag)}</TableCell>
                    <TableCell className="text-right">{r.units_sold}</TableCell>
                    <TableCell className="text-right">{gbp(r.revenue)}</TableCell>
                    <TableCell className="text-right">{r.flag === "missing_cost" ? "—" : gbp(r.costUnit)}</TableCell>
                    <TableCell className="text-right">{r.current_stock ?? "—"}</TableCell>
                    <TableCell className="text-right">{gbp(r.grossLastSold)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager page={flagPage} pageCount={flagPageCount} onChange={setFlagPage} />
            </>
            )}
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="pending">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pending queue (current SFTP file)</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Prices waiting for 3D to import. Pushes accumulate here (latest price per SKU wins);
              the nightly reconcile (23:30 UTC) confirms which went live and clears them.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!pendingQueue || pendingQueue.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Queue is empty — nothing waiting to import.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Price £<br /><span className="text-[10px] font-normal text-muted-foreground">inc VAT</span></TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Queued</TableHead>
                    <TableHead>Confirmed</TableHead>
                    <TableHead className="text-right">3D price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingQueue.map((p, i) => (
                    <TableRow key={`${p.sku}-${i}`} className={p.status !== "pending" ? "opacity-60" : ""}>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell className="text-right">{gbp(p.price)}</TableCell>
                      <TableCell>
                        {p.status === "applied" ? (
                          <Badge>applied</Badge>
                        ) : p.status === "expired" ? (
                          <Badge variant="secondary">expired</Badge>
                        ) : (
                          <Badge variant="outline" className="border-pd-accent/60 text-pd-accent">pending</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{format(new Date(p.queued_at), "dd MMM HH:mm")}</TableCell>
                      <TableCell className="text-xs">{p.applied_at ? format(new Date(p.applied_at), "dd MMM HH:mm") : "—"}</TableCell>
                      <TableCell className="text-right">{gbp(p.verified_price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="pushes">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent pushes</CardTitle>
          </CardHeader>
          <CardContent>
            {!pushes || pushes.length === 0 ? (
              <div className="text-sm text-muted-foreground">No pushes yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>SFTP path</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pushes.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{format(new Date(p.pushed_at), "PPp")}</TableCell>
                      <TableCell>{p.row_count}</TableCell>
                      <TableCell className="font-mono text-xs">{p.sftp_path}</TableCell>
                      <TableCell>
                        {p.status === "success" ? (
                          <Badge>success</Badge>
                        ) : p.status === "error" ? (
                          <Badge variant="destructive">
                            <AlertTriangle className="h-3 w-3 mr-1" />error
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{p.status}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-destructive max-w-md truncate">
                        {p.error_message ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        </TabsContent>
      </Tabs>
      )}
      </>
      )}
    </div>
  );
}
