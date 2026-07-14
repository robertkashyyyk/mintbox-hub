import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { ArrowLeft, Upload, Loader2, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight, Flame, Wand2 } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import ThreedsAutoReport from "./ThreedsAutoReport";
import AmazonReprice from "./AmazonReprice";
import { format } from "date-fns";
import {
  type Tier, type FeeRule, type CostFlag,
  TIER_OPTIONS, TIER_TARGET_POR_PCT, SUSPECT_COST_MULTIPLE, BIG_MOVE_MULTIPLE,
  POR_BAND_OPTIONS, classifyPorBand,
  effectiveFeesFor, backSolveGrossPrice, classifyCost, toGross, feeInputsForBackSolve,
} from "@/lib/reprice";
import { snapPrice, ladderFromRows, DEFAULT_LADDER, type LadderEntry } from "@/lib/charmSnap";

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
  // Tagged client-side after fetch (the RPC is per-channel and SKU-only).
  store_id?: string;
  store_name?: string | null;
  mintsoft_channel?: string | null;
}
interface PendingRow {
  store_id: string;
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
const ALL_STORES = "__all__";
// Rows are keyed by store+sku so the same SKU across stores stays distinct in "All stores" mode.
const rowKey = (r: { store_id?: string; sku: string }) => `${r.store_id ?? ""}::${r.sku}`;
// "No-op": already at target, or suggested price within 1% of current — nothing to push.
const MIN_CHANGE_PCT = 0.01;
const isNoOp = (r: { atTarget: boolean; grossLastSold: number | null; suggestedGross: number | null }) =>
  r.atTarget ||
  (r.grossLastSold != null && r.suggestedGross != null && r.grossLastSold > 0 &&
    Math.abs(r.suggestedGross - r.grossLastSold) / r.grossLastSold < MIN_CHANGE_PCT);

const gbp = (n: number | null | undefined) =>
  n == null ? "—" :
    new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toFixed(1)}%`;

// Sortable columns for the repriceable table → value accessor.
const SORT_ACCESSORS: Record<string, (r: EnrichedRow) => number | string | null> = {
  sku: (r) => r.sku,
  brand_name: (r) => r.brand_name ?? "",
  units_sold: (r) => r.units_sold ?? 0,
  revenue: (r) => r.revenue,
  profit: (r) => r.profit,
  por_pct: (r) => r.por_pct,
  costUnit: (r) => r.costUnit,
  feePctUsed: (r) => r.feePctUsed,
  current_stock: (r) => r.current_stock,
  grossLastSold: (r) => r.grossLastSold,
  suggestedGross: (r) => r.suggestedGross,
};

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

  const [channel, setChannel] = useState<"ebay" | "amazon">("ebay");
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [storeId, setStoreId] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [search, setSearch] = useState("");
  const [currentBand, setCurrentBand] = useState<string>("all"); // filter by CURRENT por band
  const [sortKey, setSortKey] = useState<string>("por_pct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [statusFilter, setStatusFilter] = useState<"outstanding" | "review" | "all">("outstanding");
  const [tier, setTier] = useState<Tier>("breakeven");
  const [selected, setSelected] = useState<Record<string, { checked: boolean; price?: string }>>({});
  const [page, setPage] = useState(1);
  const [flagPage, setFlagPage] = useState(1);

  // Charm-price ladder (source of truth = public.price_sweetspots; DEFAULT_LADDER fallback).
  const { data: ladderData } = useQuery({
    queryKey: ["price-sweetspots"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("price_sweetspots").select("price, type").eq("active", true);
      if (error) throw error;
      return ladderFromRows((data ?? []) as Array<{ price: number; type?: string }>);
    },
  });
  const ladder: LadderEntry[] = ladderData && ladderData.length ? ladderData : DEFAULT_LADDER;

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

  const isAll = storeId === ALL_STORES;
  const activeStore = stores?.find((s) => s.id === storeId) ?? null;
  const enabledStores = useMemo(() => (stores ?? []).filter((s) => s.enabled), [stores]);
  const storeNameById = (id: string) => stores?.find((s) => s.id === id)?.store_name ?? "—";

  // Header-copy fees: the active store's, or a representative store's in All mode
  // (VAT + fixed eBay fee are uniform across the UK stores; per-row fees are used for the maths).
  const fees = useMemo(
    () => effectiveFeesFor(activeStore?.mintsoft_channel ?? enabledStores[0]?.mintsoft_channel ?? "", feeRules),
    [activeStore?.mintsoft_channel, enabledStores, feeRules],
  );

  const { data: candData, isLoading: candLoading, isFetching: candFetching, isError: candError, refetch } = useQuery({
    queryKey: ["threeds_candidates", storeId, days],
    queryFn: async () => {
      // Ring-fence is enforced inside the RPC (excludes active-campaign SKUs).
      const targets = isAll ? enabledStores : activeStore ? [activeStore] : [];
      // Fetch every store in parallel and tolerate per-store failures: a single
      // store timing out must not zero the whole combined list.
      const settled = await Promise.allSettled(
        targets.map(async (st) => {
          const { data, error } = await supabase.rpc("get_threeds_reprice_candidates", {
            p_channel: st.mintsoft_channel,
            p_days: days,
          });
          if (error) throw new Error(error.message);
          return ((data ?? []) as Candidate[]).map((c) => ({
            ...c, store_id: st.id, store_name: st.store_name, mintsoft_channel: st.mintsoft_channel,
          }));
        }),
      );
      const rows: Candidate[] = [];
      const failed: string[] = [];
      settled.forEach((res, i) => {
        if (res.status === "fulfilled") rows.push(...res.value);
        else failed.push(targets[i].store_name);
      });
      // Only error the whole query if nothing came back at all.
      if (rows.length === 0 && failed.length > 0) {
        throw new Error(`No data — ${failed.join(", ")} timed out. Try a shorter look-back.`);
      }
      return { rows, failed };
    },
    enabled: isAll ? enabledStores.length > 0 : !!activeStore,
  });
  const candidates = candData?.rows;
  const failedStores = candData?.failed ?? [];

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
      let q = supabase
        .from("threeds_reprice_pending" as any)
        .select("store_id, sku, price, status, queued_at, applied_at, verified_price")
        .order("status", { ascending: true })
        .order("queued_at", { ascending: false })
        .limit(2000);
      // Single store → filter to it; All stores → every enabled store's queue.
      q = isAll ? q.in("store_id", enabledStores.map((s) => s.id)) : q.eq("store_id", storeId!);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PendingRow[];
    },
  });
  const pendingCount = (pendingQueue ?? []).filter((p) => p.status === "pending").length;
  // Map of store+SKU → queued price for rows already sitting in a pending file.
  // Pending (in the file) OR applied (gone live) within 14 days → "already repriced".
  const queuedMap = useMemo(() => {
    const m = new Map<string, { price: number; status: string }>();
    const since = Date.now() - 14 * 86_400_000;
    (pendingQueue ?? []).forEach((p) => {
      if (p.status === "pending" || (p.status === "applied" && p.applied_at && new Date(p.applied_at).getTime() >= since)) {
        m.set(rowKey(p), { price: p.price, status: p.status });
      }
    });
    return m;
  }, [pendingQueue]);

  const { data: pushes } = useQuery({
    queryKey: ["threeds_pushes", storeId],
    enabled: !!storeId,
    queryFn: async () => {
      let q = supabase
        .from("threeds_reprice_pushes")
        .select("id, pushed_at, row_count, status, sftp_path, error_message")
        .order("pushed_at", { ascending: false })
        .limit(isAll ? 30 : 10);
      q = isAll ? q.in("store_id", enabledStores.map((s) => s.id)) : q.eq("store_id", storeId!);
      const { data, error } = await q;
      if (error) throw error;
      return data as PushLog[];
    },
  });

  // Enrich every candidate with per-unit economics, cost flag and a back-solved
  // gross price for the chosen tier.
  const enriched = useMemo<EnrichedRow[]>(() => {
    const targetPorFrac = TIER_TARGET_POR_PCT[tier] / 100;
    return (candidates ?? []).map((c) => {
      // Per-row fees: in All mode each row may belong to a different channel.
      const rowFees = effectiveFeesFor(c.mintsoft_channel ?? "", feeRules);
      const units = c.units_sold > 0 ? c.units_sold : 0;
      // Pack-aware cost: prefer the derived pack_cost_unit (base unit cost ×
      // pack_size) from the RPC; fall back to cost_total/units for safety.
      const costUnit =
        c.pack_cost_unit != null && c.pack_cost_unit > 0
          ? c.pack_cost_unit
          : units > 0 ? (c.cost_total ?? 0) / units : 0;
      const courierUnit = units > 0 ? (c.courier_total ?? 0) / units : 0;
      const grossLastSold = toGross(c.current_price, rowFees.vat);
      // Flag on the pack-aware cost: cost_total from the RPC is already
      // pack_cost_unit × units (NULL when the base cost is missing).
      const flag = classifyCost({ costTotal: c.cost_total, unitsSold: units, grossPrice: grossLastSold });
      // Prefer the measured real eBay fee rate (~22%) over the modeled default.
      const { feePct, fixedFeeUnit, usedReal } = feeInputsForBackSolve(c.real_fee_rate, rowFees);
      const targetGross =
        flag === null
          ? backSolveGrossPrice({
              costUnit,
              courierUnit,
              fixedFeeUnit,
              feePct,
              vat: rowFees.vat,
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
  }, [candidates, tier, feeRules]);

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
    // Outstanding = not-repriced + NOT big-move; Review = not-repriced + big-move; All = everything.
    if (statusFilter !== "all") {
      rows = rows.filter((r) => !queuedMap.has(rowKey(r)));
      // Outstanding = real raises only (drop no-ops); Review = big moves.
      rows = rows.filter((r) => (statusFilter === "review" ? r.bigMove : !r.bigMove && !isNoOp(r)));
    }
    return rows.filter(matchesSearch);
  }, [enriched, currentBand, statusFilter, queuedMap, search]);

  // Apply column sort (nulls always last) before pagination.
  const sortedRepriceable = useMemo(() => {
    const acc = SORT_ACCESSORS[sortKey] ?? SORT_ACCESSORS.por_pct;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...repriceable].sort((a, b) => {
      const av = acc(a), bv = acc(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [repriceable, sortKey, sortDir]);
  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "sku" || key === "brand_name" ? "asc" : "desc"); }
    setPage(1);
  };
  const SortHead = ({ k, label, align, className }: { k: string; label: ReactNode; align?: "right" | "center"; className?: string }) => (
    <TableHead onClick={() => toggleSort(k)}
      className={`cursor-pointer select-none hover:text-foreground ${align === "right" ? "text-right" : align === "center" ? "text-center" : ""} ${className ?? ""}`}>
      <span className="inline-flex items-center gap-1">{label}<span className="text-[10px] text-muted-foreground">{sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span></span>
    </TableHead>
  );

  const flagged = useMemo(
    () => enriched.filter((r) => r.flag !== null).filter(matchesSearch),
    [enriched, search],
  );

  const missingCount = useMemo(() => enriched.filter((r) => r.flag === "missing_cost").length, [enriched]);
  const suspectCount = useMemo(() => enriched.filter((r) => r.flag === "suspect_cost").length, [enriched]);
  const bigMoveCount = useMemo(() => repriceable.filter((r) => r.bigMove).length, [repriceable]);

  // Reset pagination + selection when the working set changes.
  useEffect(() => { setPage(1); }, [search, currentBand, statusFilter, tier, storeId, days]);
  useEffect(() => { setFlagPage(1); }, [search, storeId, days]);
  useEffect(() => { setSelected({}); }, [storeId, days]);

  const pageCount = Math.max(1, Math.ceil(sortedRepriceable.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => sortedRepriceable.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sortedRepriceable, page],
  );
  const flagPageCount = Math.max(1, Math.ceil(flagged.length / PAGE_SIZE));
  const flagPageRows = useMemo(
    () => flagged.slice((flagPage - 1) * PAGE_SIZE, flagPage * PAGE_SIZE),
    [flagged, flagPage],
  );

  // Effective price for a row = user override, else the tier suggestion.
  const effectivePrice = (r: EnrichedRow): string =>
    selected[rowKey(r)]?.price ?? (r.suggestedGross != null ? r.suggestedGross.toFixed(2) : "");

  // Snapper: snap every in-view New £ (the floored, profitable suggestion) up to the
  // nearest charm price. Writes into the per-row override; never below the profitable
  // floor (tolerance 0). "hemmed" (forced over a barrier) + "above-ladder" are surfaced.
  const snapAll = () => {
    const ch: "charm" | "buybox" = channel === "amazon" ? "buybox" : "charm";
    let snapped = 0, hemmed = 0, aboveLadder = 0, unchanged = 0;
    setSelected((prev) => {
      const next = { ...prev };
      for (const r of repriceable) {
        if (r.suggestedGross == null) continue;
        const res = snapPrice(r.suggestedGross, ch, 0, ladder);
        if (res.listPrice == null) { aboveLadder++; continue; }
        const k = rowKey(r);
        const newPrice = res.listPrice.toFixed(2);
        if (newPrice === r.suggestedGross.toFixed(2)) unchanged++;
        next[k] = { checked: next[k]?.checked ?? false, price: newPrice };
        snapped++;
        if (res.flag === "hemmed") hemmed++;
      }
      return next;
    });
    toast({
      title: `Snapped ${snapped} to charm prices`,
      description:
        `${snapped} New £ value${snapped === 1 ? "" : "s"} moved to the nearest charm rung (never below the profitable floor).` +
        (hemmed ? ` · ${hemmed} hemmed — forced over a price barrier, worth an eyeball.` : "") +
        (aboveLadder ? ` · ${aboveLadder} above the ladder — left unchanged.` : "") +
        ` Tick the rows and Push to 3D when happy.`,
    });
  };

  const selectedRows = useMemo(() => {
    return repriceable
      .filter((r) => selected[rowKey(r)]?.checked)
      .map((r) => ({ store_id: r.store_id!, sku: r.sku, new_price: parseFloat(effectivePrice(r)) }))
      .filter((r) => !!r.store_id && !isNaN(r.new_price) && r.new_price > 0);
  }, [repriceable, selected]);

  const pushMutation = useMutation({
    mutationFn: async () => {
      if (selectedRows.length === 0) throw new Error("Tick rows and enter prices first");
      // Group by store so each store's rows land in its own queue / SFTP file.
      const byStore = new Map<string, { sku: string; new_price: number }[]>();
      for (const r of selectedRows) {
        if (!byStore.has(r.store_id)) byStore.set(r.store_id, []);
        byStore.get(r.store_id)!.push({ sku: r.sku, new_price: r.new_price });
      }
      let added = 0;
      const paths: string[] = [];
      const failures: string[] = [];
      for (const [sid, rows] of byStore) {
        const { data, error } = await supabase.functions.invoke("threeds-reprice-push", {
          body: { store_id: sid, rows },
        });
        if (error || data?.error) { failures.push(error?.message ?? data?.error ?? "unknown error"); continue; }
        added += data.added ?? 0;
        if (data.sftp_path) paths.push(data.sftp_path);
      }
      if (failures.length && added === 0) throw new Error(failures.join("; "));
      return { added, storeCount: byStore.size, paths, failures };
    },
    onSuccess: (data) => {
      toast({
        title: "Pushed to 3D",
        description:
          `Added ${data.added} price${data.added === 1 ? "" : "s"} across ${data.storeCount} store${data.storeCount === 1 ? "" : "s"} ` +
          `(${data.paths.join(", ")}). Cleared nightly once confirmed live.` +
          (data.failures.length ? ` ⚠ ${data.failures.length} store(s) failed: ${data.failures.join("; ")}` : ""),
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
        const k = rowKey(r);
        if (queuedMap.has(k)) continue; // skip rows already in the pending queue
        if (checked) next[k] = { checked: true, price: prev[k]?.price };
        else delete next[k];
      }
      return next;
    });
  };
  const selectablePageRows = pageRows.filter((r) => !queuedMap.has(rowKey(r)));
  const allChecked = selectablePageRows.length > 0 && selectablePageRows.every((r) => selected[rowKey(r)]?.checked);

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
          title="Reprice"
          description="eBay/3D: pick a store and tier, review the inc-VAT price, push via SFTP. Amazon: live view of the autonomous eSagu repricer."
          icon={RefreshCw}
        />
      </div>

      {channel === "ebay" && fencedCount > 0 && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-400 flex items-center gap-2">
          <Flame className="h-3.5 w-3.5 flex-shrink-0" />
          {fencedCount} SKU{fencedCount === 1 ? "" : "s"} ring-fenced under an active price campaign — excluded from repricing.{" "}
          <a href="/decisions/liquidation" className="underline">View campaigns</a>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <ToggleGroup type="single" value={channel} onValueChange={(v) => v && setChannel(v as "ebay" | "amazon")} className="justify-start">
          <ToggleGroupItem value="ebay" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white px-4">eBay / 3D</ToggleGroupItem>
          <ToggleGroupItem value="amazon" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white px-4">Amazon</ToggleGroupItem>
        </ToggleGroup>
        {channel === "ebay" && (
          <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as "manual" | "auto")} className="justify-start">
            <ToggleGroupItem value="manual" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white px-4">Semi-Manual</ToggleGroupItem>
            <ToggleGroupItem value="auto" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white px-4">Auto-Report</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      {channel === "amazon" && <AmazonReprice />}

      {channel === "ebay" && mode === "auto" && <ThreedsAutoReport />}

      {channel === "ebay" && mode === "manual" && (
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
                <SelectItem value={ALL_STORES} disabled={enabledStores.length === 0}>
                  <strong>All stores</strong> <span className="text-muted-foreground">— every enabled account</span>
                </SelectItem>
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
            <label className="text-xs text-muted-foreground">Show</label>
            <ToggleGroup type="single" value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as "outstanding" | "review" | "all")} className="justify-start">
              <ToggleGroupItem value="outstanding" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white text-xs px-3 h-9">Outstanding</ToggleGroupItem>
              <ToggleGroupItem value="review" className="data-[state=on]:bg-warning data-[state=on]:text-white text-xs px-3 h-9">Review</ToggleGroupItem>
              <ToggleGroupItem value="all" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white text-xs px-3 h-9">All</ToggleGroupItem>
            </ToggleGroup>
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
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={!storeId}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      {candError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          Couldn’t load candidates — the query timed out. Try a shorter look-back (e.g. 30 days).
        </div>
      )}
      {failedStores.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          {failedStores.length} store{failedStores.length === 1 ? "" : "s"} timed out and {failedStores.length === 1 ? "was" : "were"} skipped:{" "}
          <strong>{failedStores.join(", ")}</strong>. Showing the rest — a shorter look-back will include them.
        </div>
      )}

      {(activeStore || isAll) && (
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
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="secondary"
                onClick={snapAll}
                disabled={candFetching || repriceable.length === 0}
                title="Snap every New £ in view up to the nearest charm price (e.g. 14.08 → 14.95). Never drops below the profitable floor."
              >
                <Wand2 className="h-4 w-4 mr-2" /> Snapper
              </Button>
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
            </div>
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
                      <SortHead k="sku" label="SKU" />
                      {isAll && <TableHead>Account</TableHead>}
                      <SortHead k="brand_name" label="Brand" />
                      <TableHead className="text-center">Pack</TableHead>
                      <SortHead k="units_sold" label="Units" align="right" />
                      <SortHead k="revenue" label="Revenue" align="right" />
                      <SortHead k="profit" label="Profit" align="right" />
                      <SortHead k="por_pct" label="PoR%" align="right" />
                      <SortHead k="costUnit" label="Cost ea" align="right" />
                      <SortHead k="feePctUsed" label="Fee" align="right" />
                      <SortHead k="current_stock" label="Stock" align="right" />
                      <SortHead k="grossLastSold" align="right" label={<>Last Sold £<br /><span className="text-[10px] font-normal text-muted-foreground">inc VAT</span></>} />
                      <SortHead k="suggestedGross" align="right" className="w-[120px]" label={<>New £<br /><span className="text-[10px] font-normal text-muted-foreground">inc VAT</span></>} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((r) => {
                      const k = rowKey(r);
                      const sel = selected[k];
                      const negative = (r.profit ?? 0) < 0;
                      const defaultPrice = r.suggestedGross != null ? r.suggestedGross.toFixed(2) : "";
                      return (
                        <TableRow key={k} className={negative ? "bg-destructive/5" : ""}>
                          <TableCell>
                            <Checkbox
                              checked={!!sel?.checked}
                              onCheckedChange={(v) =>
                                setSelected((p) => ({
                                  ...p,
                                  [k]: { checked: !!v, price: p[k]?.price },
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                          {isAll && <TableCell className="text-xs">{r.store_name ?? "—"}</TableCell>}
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
                                    [k]: { checked: p[k]?.checked ?? false, price: e.target.value },
                                  }))
                                }
                                placeholder={defaultPrice}
                              />
                              {queuedMap.has(k) ? (
                                <Badge variant="secondary" className="border-pd-accent/60 bg-pd-accent/15 text-pd-accent text-[10px] whitespace-nowrap"
                                  title={queuedMap.get(k)?.status === "applied" ? `Already repriced to ${gbp(queuedMap.get(k)?.price)} and live — give the sales data time to catch up.` : `Queued at ${gbp(queuedMap.get(k)?.price)} — waiting for 3D to import.`}>
                                  {queuedMap.get(k)?.status === "applied" ? "✓ repriced" : "✓ queued"} {gbp(queuedMap.get(k)?.price)}
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
                  {isAll && <TableHead>Account</TableHead>}
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
                  <TableRow key={rowKey(r)}>
                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                    {isAll && <TableCell className="text-xs">{r.store_name ?? "—"}</TableCell>}
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
                    {isAll && <TableHead>Account</TableHead>}
                    <TableHead className="text-right">Price £<br /><span className="text-[10px] font-normal text-muted-foreground">inc VAT</span></TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Queued</TableHead>
                    <TableHead>Confirmed</TableHead>
                    <TableHead className="text-right">3D price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingQueue.map((p, i) => (
                    <TableRow key={`${p.store_id}-${p.sku}-${i}`} className={p.status !== "pending" ? "opacity-60" : ""}>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      {isAll && <TableCell className="text-xs">{storeNameById(p.store_id)}</TableCell>}
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
