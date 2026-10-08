import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageLoader } from "@/components/ui/PageLoader";
import ModuleHeader from "@/components/ModuleHeader";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowUpDown, Truck, Download, AlertTriangle, MoreHorizontal, ChevronDown,
  Flame, PackageX, Clock, TrendingUp, Undo2,
} from "lucide-react";

interface Row {
  marketplace_id: string;
  country_code: string | null;
  base_sku: string;
  weekly_velocity: number | null;
  units_7d: number | null;
  units_30d: number | null;
  fba_on_hand: number | null;
  fba_in_transit: number | null;
  target_units: number | null;
  days_of_cover_weeks: number | null;
  units_to_order: number | null;
  replenish_flag: boolean | null;
  unit_cost: number | null;
  reorder_cost: number | null;
  avg_sell_price: number | null;
  gross_margin_pct: number | null;
  referral_fee_per_unit: number | null;
  fba_fee_per_unit: number | null;
  net_per_unit: number | null;
  net_margin_pct: number | null;
  data_as_of: string | null;
  asins: string | null;
  ever_fba: boolean | null;
  fbm_units_90d: number | null;
  fbm_net_per_unit: number | null;
  fbm_price_gross: number | null;
  fba_net_per_unit_eff: number | null;
  net_diff: number | null;
  fee_source: string | null;
  is_candidate: boolean | null;
  suggested_first_send: number | null;
  fba_reserved: number | null;
  fba_inbound_working: number | null;
  fba_inbound_shipped: number | null;
  fba_inbound_receiving: number | null;
  pending_send_units: number | null;
  shipment_extra_units: number | null;
  coleraine_available: number | null;
  coleraine_placeholder: boolean | null;
  can_send_now: number | null;
  buy_first: boolean | null;
  amazon_seller_sku: string | null;
  title: string | null;
  is_hazmat: boolean | null;
  hazmat_source: string | null;
  is_excluded: boolean | null;
  fbm_orders_90d: number | null;
}

interface Snooze {
  base_sku: string; kind: string; until_date: string; note: string | null;
  set_by: string; original_velocity: number | null; context: any;
}

const gbp = (v: number | null | undefined) =>
  v == null ? "—" : `£${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nf = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const csvCell = (s: unknown) => {
  const v = s == null ? "" : String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const downloadCsv = (name: string, lines: unknown[][]) => {
  const csv = lines.map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};
const brandOf = (sku: string) => {
  const m = sku.match(/^([A-Z0-9]{2,4})[-/_]/i);
  return m ? m[1].toUpperCase() : sku.slice(0, 3).toUpperCase();
};

type SortField = keyof Row;
type Bands = Record<string, number>;

const porBandClass = (por: number | null, bands: Bands | null) => {
  if (por == null || !bands) return "text-muted-foreground";
  if (por < (bands.loss_max ?? -1)) return "text-red-600 font-semibold";
  if (por <= (bands.breakeven_max ?? 1)) return "text-red-500";
  if (por <= (bands.poor_max ?? 9.99)) return "text-amber-600";
  if (por <= (bands.average_max ?? 19.99)) return "text-yellow-600";
  if (por <= (bands.good_max ?? 24.99)) return "text-green-600";
  if (por <= (bands.great_max ?? 29.99)) return "text-green-700 font-medium";
  return "text-emerald-700 font-semibold";
};

const FbaReplenishment = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  // ---- URL-backed filters ---------------------------------------------------
  const tab = params.get("tab") ?? "replenish";
  const search = params.get("q") ?? "";
  const brandFilter = (params.get("brand") ?? "").split(",").filter(Boolean);
  const mkt = params.get("mkt") ?? "all";
  const minVel = Number(params.get("minvel") ?? 0) || 0;
  const minNet = params.get("minnet") ? Number(params.get("minnet")) : null;
  const hideFading = params.get("fading") !== "show";
  const csnOnly = params.get("csn") === "1";
  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v == null || v === "" || v === "all") p.delete(k); else p.set(k, v);
    setParams(p, { replace: true });
  };

  const [sort, setSort] = useState<{ field: SortField; dir: "asc" | "desc" }>({ field: "reorder_cost", dir: "desc" });
  const [selected, setSelected] = useState<Record<string, number>>({}); // base_sku -> qty
  const [deferDialog, setDeferDialog] = useState<{ skus: string[]; hazmat: boolean } | null>(null);
  const [deferReason, setDeferReason] = useState("dangerous_goods");
  const [deferNote, setDeferNote] = useState("");
  const [sendDialogOpen, setSendDialogOpen] = useState(false);

  // ---- data -----------------------------------------------------------------
  const { data, isLoading, error } = useQuery({
    queryKey: ["fba-replenishment-v3"],
    queryFn: async (): Promise<Row[]> => {
      // PostgREST caps responses at 1,000 rows: range-paginate to get them all.
      const out: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await (supabase as any)
          .from("v_fba_replenishment")
          .select("*")
          .order("base_sku", { ascending: true })
          .range(from, from + 999);
        if (error) throw error;
        out.push(...((data ?? []) as Row[]));
        if (!data || data.length < 1000) break;
      }
      return out;
    },
    retry: (failureCount, err: any) => err?.code !== "57014" && failureCount < 2,
  });

  const { data: snoozes } = useQuery({
    queryKey: ["fba-snoozes"],
    queryFn: async (): Promise<Snooze[]> => {
      const { data, error } = await (supabase as any).rpc("amazon_fba_active_snoozes");
      if (error) throw error;
      return (data ?? []) as Snooze[];
    },
  });

  const { data: deferred } = useQuery({
    queryKey: ["fba-deferred"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("amazon_fba_deferred_list_v2");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: batches } = useQuery({
    queryKey: ["fba-send-batches"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("amazon_fba_send_batches");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: bands } = useQuery({
    queryKey: ["profit-loss-bands"],
    queryFn: async (): Promise<Bands | null> => {
      const { data } = await (supabase as any).from("app_settings").select("value").eq("key", "profit.loss_bands").maybeSingle();
      return (data?.value ?? null) as Bands | null;
    },
  });

  const { data: fbmCfg } = useQuery({
    queryKey: ["fbm-vs-fba-cfg"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("app_settings").select("value").eq("key", "amazon.fbm_vs_fba").maybeSingle();
      return {
        handling: Number(data?.value?.handling_cost_per_order ?? 1.25),
        minGbp: Number(data?.value?.flag_min_gbp_per_unit ?? 1.5),
        minPct: Number(data?.value?.flag_min_pct ?? 30),
      };
    },
  });
  const handlingCfg = fbmCfg ?? { handling: 1.25, minGbp: 1.5, minPct: 30 };

  // FBM net adjusted for handling (labour/packaging per ORDER, converted to
  // per-unit with the SKU's real orders:units ratio) so FBM-vs-FBA compares
  // like for like — FBA's fee already covers pick/pack.
  const fbmNetAdj = (r: Row): number | null => {
    if (r.fbm_net_per_unit == null) return null;
    const units = r.fbm_units_90d ?? 0;
    const orders = r.fbm_orders_90d ?? units; // worst case: one order per unit
    const perUnit = units > 0 ? (handlingCfg.handling * orders) / units : handlingCfg.handling;
    return r.fbm_net_per_unit - perUnit;
  };
  // "Review: FBM may be better" — information only, never feeds any automation.
  const fbmReviewFlag = (r: Row): boolean => {
    const adj = fbmNetAdj(r);
    const fba = r.fba_net_per_unit_eff;
    if (adj == null || fba == null) return false;
    if (adj - fba < handlingCfg.minGbp) return false;
    return fba <= 0 || (adj / fba - 1) * 100 >= handlingCfg.minPct;
  };
  // How much Amazon volume FBM could lose (Prime-driven) before the switch
  // stops paying: 1 - fba_net / fbm_net_after_handling.
  const volumeLossHeadroom = (r: Row): number | null => {
    const adj = fbmNetAdj(r);
    const fba = r.fba_net_per_unit_eff;
    if (adj == null || adj <= 0 || fba == null) return null;
    if (fba <= 0) return 100;
    return Math.round((1 - fba / adj) * 100);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["fba-replenishment-v3"] });
    queryClient.invalidateQueries({ queryKey: ["fba-snoozes"] });
    queryClient.invalidateQueries({ queryKey: ["fba-deferred"] });
    queryClient.invalidateQueries({ queryKey: ["fba-send-batches"] });
  };

  // ---- mutations ------------------------------------------------------------
  const deferMutation = useMutation({
    mutationFn: async (args: { skus: string[]; kind: string; reason?: string; note?: string; weeks?: number }) => {
      for (const sku of args.skus) {
        const { error } = await (supabase as any).rpc("amazon_fba_defer", {
          p_base_sku: sku, p_kind: args.kind, p_reason: args.reason ?? null,
          p_note: args.note ?? null, p_weeks: args.weeks ?? 4,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_d, args) => {
      toast({ title: args.kind === "never" ? "Marked never-send" : args.kind === "not_now" ? "Hidden until Monday" : "Snoozed", description: `${args.skus.length} SKU(s)` });
      setDeferDialog(null); setDeferNote(""); setSelected({}); invalidate();
    },
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const undeferMutation = useMutation({
    mutationFn: async (sku: string) => {
      const { error } = await (supabase as any).rpc("amazon_fba_undefer", { p_base_sku: sku });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Returned to the list" }); invalidate(); },
    onError: (e: any) => toast({ title: "Un-defer failed", description: e.message, variant: "destructive" }),
  });

  const delayRaiseMutation = useMutation({
    mutationFn: async (skus: string[]) => {
      const results: any[] = [];
      for (const sku of skus) {
        const { data, error } = await (supabase as any).rpc("amazon_fba_delay_raise", { p_base_sku: sku });
        if (error) throw error;
        results.push({ sku, ...data });
      }
      return results;
    },
    onSuccess: (results) => {
      const flagged = results.filter((r) => r.flagged_over_20pct);
      const queued = results.filter((r) => r.ok && !r.flagged_over_20pct);
      toast({
        title: "Delay & raise",
        description: `${queued.length} queued for repricing (applies via the overnight push), ${flagged.length} flagged >20% for Clive. Snoozed 4 weeks.`,
      });
      setSelected({}); invalidate();
    },
    onError: (e: any) => toast({ title: "Delay & raise failed", description: e.message, variant: "destructive" }),
  });

  const cancelBatchMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("amazon_fba_cancel_send_batch", { p_batch_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Batch cancelled" }); invalidate(); },
  });

  // ---- derived rows ---------------------------------------------------------
  const rows = data ?? [];
  const dataAsOf = rows.length > 0 ? rows[0].data_as_of : null;
  const snoozeMap = useMemo(() => {
    const m = new Map<string, Snooze>();
    (snoozes ?? []).forEach((s) => m.set(s.base_sku, s));
    return m;
  }, [snoozes]);

  // A snoozed SKU returns early if it genuinely stocks out while still moving.
  const isHidden = (r: Row) => {
    if (r.is_excluded) return true;
    const s = snoozeMap.get(r.base_sku);
    if (!s) return false;
    const earlyReturn = s.kind !== "raise_hold"
      && (r.fba_on_hand ?? 0) === 0
      && s.original_velocity != null && (r.weekly_velocity ?? 0) >= s.original_velocity;
    return !earlyReturn;
  };

  const applyCommonFilters = (list: Row[]) => {
    let out = list;
    if (brandFilter.length) out = out.filter((r) => brandFilter.includes(brandOf(r.base_sku)));
    if (mkt !== "all") out = out.filter((r) => r.country_code === mkt);
    if (minVel > 0) out = out.filter((r) => (r.weekly_velocity ?? 0) >= minVel);
    if (minNet != null) out = out.filter((r) => (r.net_margin_pct ?? -999) >= minNet);
    if (csnOnly) out = out.filter((r) => (r.can_send_now ?? 0) > 0);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => r.base_sku.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q));
    }
    return out;
  };

  const sortRows = (list: Row[]) => {
    const { field, dir } = sort;
    return [...list].sort((a, b) => {
      const av = a[field], bv = b[field];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return dir === "asc" ? av - bv : bv - av;
      return dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  };

  const replenishAll = useMemo(
    () => applyCommonFilters(rows.filter((r) => r.ever_fba && r.replenish_flag && !isHidden(r))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, snoozeMap, brandFilter.join(","), mkt, minVel, minNet, csnOnly, search],
  );
  const fading = useMemo(() => replenishAll.filter((r) => !r.units_30d), [replenishAll]);
  const replenish = useMemo(
    () => sortRows(hideFading ? replenishAll.filter((r) => !!r.units_30d) : replenishAll),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replenishAll, hideFading, sort],
  );

  // Break-even Prime uplift: extra FBA volume needed for FBA total contribution
  // to match FBM at current velocity. Only meaningful when FBA net > 0.
  const upliftPct = (r: Row): number | null => {
    const fba = r.fba_net_per_unit_eff, fbm = r.fbm_net_per_unit;
    if (fba == null || fbm == null || fba <= 0) return null;
    if ((r.net_diff ?? 0) > 0) return 0; // FBA already wins per unit
    return Math.round((fbm / fba - 1) * 100);
  };

  const uplift50Only = params.get("uplift") === "50";
  const candidates = useMemo(
    () => sortRows(applyCommonFilters(rows.filter((r) => {
      if (r.ever_fba || r.is_excluded || isHidden(r)) return false;
      const preFilter = (r.weekly_velocity ?? 0) >= 3 && (r.units_30d ?? 0) >= 8;
      if (!preFilter) return false;
      // Send candidates (FBA beats FBM) plus TEST candidates (FBA profitable
      // but behind FBM — worth a Prime-uplift trial, not a send).
      const u = upliftPct(r);
      const testCandidate = u != null && u > 0;
      if (!(r.is_candidate || testCandidate)) return false;
      if (uplift50Only && (u == null || u > 50)) return false;
      return true;
    }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, snoozeMap, brandFilter.join(","), mkt, minVel, minNet, csnOnly, search, sort, uplift50Only],
  );

  const brandCounts = useMemo(() => {
    const src = rows.filter((r) => (tab === "candidates"
      ? !r.ever_fba && (r.is_candidate || (upliftPct(r) ?? -1) > 0) && (r.weekly_velocity ?? 0) >= 3 && (r.units_30d ?? 0) >= 8
      : r.ever_fba && r.replenish_flag) && !isHidden(r));
    const m = new Map<string, number>();
    src.forEach((r) => m.set(brandOf(r.base_sku), (m.get(brandOf(r.base_sku)) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tab, snoozeMap]);

  const countries = useMemo(
    () => Array.from(new Set(rows.map((r) => r.country_code).filter(Boolean))).sort() as string[],
    [rows],
  );

  // ---- selection + send-in --------------------------------------------------
  const visibleList = tab === "candidates" ? candidates : replenish;
  const toggleSelect = (r: Row, on: boolean) => {
    setSelected((p) => {
      const n = { ...p };
      if (on) n[r.base_sku] = p[r.base_sku] ?? (tab === "candidates" ? (r.suggested_first_send ?? 0) : (r.can_send_now ?? 0));
      else delete n[r.base_sku];
      return n;
    });
  };
  const selectAllFiltered = () => {
    const n: Record<string, number> = {};
    visibleList.forEach((r) => { n[r.base_sku] = tab === "candidates" ? (r.suggested_first_send ?? 0) : (r.can_send_now ?? 0); });
    setSelected(n);
  };
  const selRows = visibleList.filter((r) => r.base_sku in selected);
  const selTotals = useMemo(() => ({
    skus: selRows.length,
    units: selRows.reduce((a, r) => a + (selected[r.base_sku] ?? 0), 0),
    cost: selRows.reduce((a, r) => a + (selected[r.base_sku] ?? 0) * (r.unit_cost ?? 0), 0),
    contribWk: selRows.reduce((a, r) => a + (r.fba_net_per_unit_eff ?? r.net_per_unit ?? 0) * (r.weekly_velocity ?? 0), 0),
  }), [selRows, selected]);
  const selBlocked = selRows.filter((r) => r.is_hazmat || !r.amazon_seller_sku);

  const createSendIn = async () => {
    const good = selRows.filter((r) => !r.is_hazmat && r.amazon_seller_sku && (selected[r.base_sku] ?? 0) > 0);
    if (!good.length) { toast({ title: "Nothing sendable selected", variant: "destructive" }); return; }
    const lines = good.map((r) => ({
      base_sku: r.base_sku, amazon_seller_sku: r.amazon_seller_sku,
      asin: (r.asins ?? "").split(", ")[0] || null, qty: selected[r.base_sku],
    }));
    const { data, error } = await (supabase as any).rpc("amazon_fba_create_send_batch", {
      p_lines: lines, p_note: `Created from FBA Replenishment (${tab})`,
    });
    if (error) { toast({ title: "Send-in failed", description: error.message, variant: "destructive" }); return; }

    const stamp = new Date().toISOString().slice(0, 10);
    // Amazon "Send to Amazon" SKU-list upload. NOTE: header set to be confirmed
    // against the current Seller Central template — flagged in the rollout notes.
    downloadCsv(`amazon-send-to-amazon-${stamp}.csv`, [
      ["Merchant SKU", "Quantity", "Prep owner", "Labeling owner", "Expiration date", "ASIN (reference)"],
      ...good.map((r) => [r.amazon_seller_sku, selected[r.base_sku], "Seller", "Seller", "", (r.asins ?? "").split(", ")[0] ?? ""]),
    ]);
    // Warehouse pick list (no bin locations held in the Hub yet — column left blank).
    downloadCsv(`fba-pick-list-${stamp}.csv`, [
      ["Hub SKU", "Title", "ASIN", "Quantity", "Coleraine location"],
      ...[...good].sort((a, b) => a.base_sku.localeCompare(b.base_sku))
        .map((r) => [r.base_sku, r.title ?? "", (r.asins ?? "").split(", ")[0] ?? "", selected[r.base_sku], ""]),
    ]);
    toast({ title: "Send-in batch created", description: `${good.length} SKUs, ${good.reduce((a, r) => a + selected[r.base_sku], 0)} units. Both files downloaded; units now count as in-transit.` });
    setSelected({}); setSendDialogOpen(false); invalidate();
  };

  // ---- small render helpers -------------------------------------------------
  const toggleSort = (field: SortField) =>
    setSort((p) => ({ field, dir: p.field === field && p.dir === "desc" ? "asc" : "desc" }));
  const SortHead = ({ field, label, className }: { field: SortField; label: string; className?: string }) => (
    <TableHead className={className}>
      <Button variant="ghost" size="sm" onClick={() => toggleSort(field)} className="h-8 px-2 -ml-2 whitespace-nowrap">
        {label}<ArrowUpDown className="ml-1 h-3 w-3" />
      </Button>
    </TableHead>
  );

  const inTransitTitle = (r: Row) =>
    `Working ${nf(r.fba_inbound_working)} · Shipped ${nf(r.fba_inbound_shipped)} · Receiving ${nf(r.fba_inbound_receiving)} · Pending send ${nf(r.pending_send_units)} · Shipment (not yet in feed) ${nf(r.shipment_extra_units)}`;

  const rowActions = (r: Row) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs">{r.base_sku}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => deferMutation.mutate({ skus: [r.base_sku], kind: "snooze", weeks: 2 })}><Clock className="h-3.5 w-3.5 mr-2" />Snooze 2 weeks</DropdownMenuItem>
        <DropdownMenuItem onClick={() => deferMutation.mutate({ skus: [r.base_sku], kind: "snooze", weeks: 4 })}><Clock className="h-3.5 w-3.5 mr-2" />Snooze 4 weeks</DropdownMenuItem>
        <DropdownMenuItem onClick={() => deferMutation.mutate({ skus: [r.base_sku], kind: "snooze", weeks: 8 })}><Clock className="h-3.5 w-3.5 mr-2" />Snooze 8 weeks</DropdownMenuItem>
        <DropdownMenuItem onClick={() => deferMutation.mutate({ skus: [r.base_sku], kind: "not_now" })}>Not now (until Monday)</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => delayRaiseMutation.mutate([r.base_sku])}><TrendingUp className="h-3.5 w-3.5 mr-2" />Delay &amp; raise price</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={() => { setDeferReason(r.is_hazmat ? "dangerous_goods" : "other"); setDeferDialog({ skus: [r.base_sku], hazmat: !!r.is_hazmat }); }}>
          <PackageX className="h-3.5 w-3.5 mr-2" />Never send to FBA…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const skuCell = (r: Row) => (
    <TableCell className="font-medium whitespace-nowrap">
      <div className="flex items-center gap-1.5">
        <Checkbox checked={r.base_sku in selected} onCheckedChange={(v) => toggleSelect(r, !!v)} />
        <span title={r.title ?? undefined}>{r.base_sku}</span>
        {r.country_code && <Badge variant="outline" className="text-[10px]">{r.country_code}</Badge>}
        {r.is_hazmat && (
          <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600 cursor-pointer"
            title={`Flagged ${r.hazmat_source === "keyword" ? "by title keywords" : "as dangerous goods"} — click to review "Never send"`}
            onClick={() => { setDeferReason("dangerous_goods"); setDeferDialog({ skus: [r.base_sku], hazmat: true }); }}>
            <Flame className="h-2.5 w-2.5 mr-0.5" />DG?
          </Badge>
        )}
        {!r.amazon_seller_sku && <Badge variant="outline" className="text-[10px] border-red-400 text-red-500" title="No Amazon seller SKU with FBA history — cannot be put on a send-in file">no FBA SKU</Badge>}
        {r.buy_first && <Badge variant="outline" className="text-[10px] border-orange-400 text-orange-600" title="Units to order exceed Coleraine availability">buy first</Badge>}
      </div>
    </TableCell>
  );

  const filterBar = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search SKU / title…" value={search} onChange={(e) => setParam("q", e.target.value)} className="max-w-xs h-9" />
        {countries.length > 1 && (
          <select value={mkt} onChange={(e) => setParam("mkt", e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="all">All marketplaces</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1.5 text-sm">
          <Label htmlFor="minvel" className="text-xs text-muted-foreground">Min vel/wk</Label>
          <Input id="minvel" type="number" min={0} step={0.5} value={minVel || ""} placeholder="0"
            onChange={(e) => setParam("minvel", e.target.value)} className="w-16 h-9" />
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <Label htmlFor="minnet" className="text-xs text-muted-foreground">Min net %</Label>
          <Input id="minnet" type="number" step={1} value={minNet ?? ""} placeholder="—"
            onChange={(e) => setParam("minnet", e.target.value)} className="w-16 h-9" />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="csn" checked={csnOnly} onCheckedChange={(v) => setParam("csn", v ? "1" : null)} />
          <Label htmlFor="csn" className="text-sm">Can send now only</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="fading" checked={!hideFading} onCheckedChange={(v) => setParam("fading", v ? "show" : null)} />
          <Label htmlFor="fading" className="text-sm">Show fading inline</Label>
        </div>
        {tab === "candidates" && (
          <div className="flex items-center gap-2">
            <Switch id="uplift50" checked={uplift50Only} onCheckedChange={(v) => setParam("uplift", v ? "50" : null)} />
            <Label htmlFor="uplift50" className="text-sm">Break-even uplift ≤ 50%</Label>
          </div>
        )}
      </div>
      {brandCounts.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {brandCounts.map(([b, n]) => (
            <Badge key={b} variant={brandFilter.includes(b) ? "default" : "outline"} className="cursor-pointer select-none"
              onClick={() => {
                const next = brandFilter.includes(b) ? brandFilter.filter((x) => x !== b) : [...brandFilter, b];
                setParam("brand", next.join(",") || null);
              }}>
              {b} <span className="ml-1 opacity-70">{n}</span>
            </Badge>
          ))}
          {brandFilter.length > 0 && (
            <Badge variant="secondary" className="cursor-pointer" onClick={() => setParam("brand", null)}>clear</Badge>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6 pb-24">
      <ModuleHeader
        title="FBA Replenishment"
        description={`Replenish = ever-in-FBA restock list. Candidates = never-FBA decision list, not a send-in list. Recomputed nightly${dataAsOf ? ` — data as of ${new Date(dataAsOf).toLocaleString()}` : ""}.`}
        icon={Truck}
      />

      {error ? (
        <Card className="border-destructive/50">
          <CardHeader className="flex flex-row items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <CardTitle className="text-base">Couldn't load replenishment data</CardTitle>
              <CardDescription className="mt-1">
                {(error as any)?.code === "57014" ? "The database query timed out." : ((error as any)?.message ?? "Unexpected error.")}{" "}
                Refresh to try again; if it persists, the nightly snapshot may need attention.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => { setParam("tab", v === "replenish" ? null : v); setSelected({}); }}>
        <TabsList>
          <TabsTrigger value="replenish">Replenish ({replenish.length})</TabsTrigger>
          <TabsTrigger value="candidates">FBA Candidates ({candidates.length})</TabsTrigger>
          <TabsTrigger value="deferred">Deferred ({(deferred ?? []).length})</TabsTrigger>
          <TabsTrigger value="batches">Send-in batches ({(batches ?? []).length})</TabsTrigger>
        </TabsList>

        {/* ---------------- Replenish ---------------- */}
        <TabsContent value="replenish" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Replenish — ever-in-FBA restock list</CardTitle>
                <CardDescription>Target cover less FBA on-hand (incl. FC transfer/processing reserved) and all in-transit. Sorted by Reorder £.</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAllFiltered}>Select all filtered</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {filterBar}
              {isLoading ? (
                <PageLoader rows={12} columns={[180, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70]} label="Loading replenishment" />
              ) : (
                <div className="rounded-md border [&>div]:max-h-[65vh] [&>div]:overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow>
                        <SortHead field="base_sku" label="SKU" />
                        <SortHead field="weekly_velocity" label="Vel/wk" className="text-right" />
                        <SortHead field="units_30d" label="30d" className="text-right" />
                        <SortHead field="fba_on_hand" label="FBA on-hand" className="text-right" />
                        <SortHead field="fba_reserved" label="FBA reserved" className="text-right" />
                        <SortHead field="fba_in_transit" label="FBA in-transit" className="text-right" />
                        <SortHead field="days_of_cover_weeks" label="Wks cover" className="text-right" />
                        <SortHead field="units_to_order" label="To order" className="text-right" />
                        <SortHead field="coleraine_available" label="Coleraine" className="text-right" />
                        <SortHead field="can_send_now" label="Can send" className="text-right" />
                        <SortHead field="fba_fee_per_unit" label="FBA £" className="text-right" />
                        <SortHead field="net_margin_pct" label="Net %" className="text-right" />
                        <SortHead field="net_diff" label="FBM Δ" className="text-right" />
                        <SortHead field="reorder_cost" label="Reorder £" className="text-right" />
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {replenish.length === 0 ? (
                        <TableRow><TableCell colSpan={15} className="text-center py-8 text-muted-foreground">No SKUs match</TableCell></TableRow>
                      ) : replenish.map((r) => {
                        const por = r.avg_sell_price ? ((r.net_per_unit ?? 0) / (r.avg_sell_price * 1.2)) * 100 : null;
                        return (
                          <TableRow key={r.base_sku}>
                            {skuCell(r)}
                            <TableCell className="text-right font-medium">{nf(r.weekly_velocity, 1)}</TableCell>
                            <TableCell className="text-right">{nf(r.units_30d)}</TableCell>
                            <TableCell className="text-right">{(r.fba_on_hand ?? 0) === 0 ? <Badge variant="destructive">0</Badge> : nf(r.fba_on_hand)}</TableCell>
                            <TableCell className="text-right text-muted-foreground" title="FC transfer + FC processing (counted in on-hand); customer-order reserved excluded">{nf(r.fba_reserved)}</TableCell>
                            <TableCell className="text-right" title={inTransitTitle(r)}>{nf(r.fba_in_transit)}</TableCell>
                            <TableCell className="text-right">{nf(r.days_of_cover_weeks, 1)}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{nf(r.units_to_order)}</TableCell>
                            <TableCell className="text-right" title={r.coleraine_placeholder ? "Remote-feed placeholder (99/999) — treated as 0" : "Coleraine LIVE stock"}>
                              {r.coleraine_placeholder ? <span className="text-muted-foreground">0*</span> : nf(r.coleraine_available)}
                            </TableCell>
                            <TableCell className="text-right">
                              {r.base_sku in selected ? (
                                <Input type="number" min={0} className="w-16 h-7 text-right inline-block"
                                  value={selected[r.base_sku]}
                                  onChange={(e) => setSelected((p) => ({ ...p, [r.base_sku]: Math.max(0, Number(e.target.value) || 0) }))} />
                              ) : nf(r.can_send_now)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground" title={`Fee source: ${r.fee_source ?? "—"}`}>{gbp(r.fba_fee_per_unit)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${porBandClass(por, bands ?? null)}`}>{r.net_margin_pct == null ? "—" : `${nf(r.net_margin_pct, 1)}%`}</TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap"
                              title={(() => {
                                const adj = fbmNetAdj(r);
                                const head = volumeLossHeadroom(r);
                                return [
                                  `FBA net ${gbp(r.fba_net_per_unit_eff)}/unit`,
                                  `FBM net ${gbp(r.fbm_net_per_unit)}/unit before handling, ${gbp(adj)} after (£${handlingCfg.handling.toFixed(2)}/order handling — assumption)`,
                                  head != null && head > 0 ? `FBM stays better until ~${nf(head)}% of Amazon volume is lost to the missing Prime badge` : null,
                                ].filter(Boolean).join("\n");
                              })()}>
                              {r.net_diff == null ? "—" : gbp(r.net_diff)}
                              {fbmReviewFlag(r) && (
                                <Badge variant="outline" className="ml-1 text-[10px] border-amber-500 text-amber-600">
                                  Review: FBM may be better
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{gbp(r.reorder_cost)}</TableCell>
                            <TableCell>{rowActions(r)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {hideFading && fading.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-muted-foreground">
                      <ChevronDown className="h-4 w-4 mr-1" />Fading — check before sending ({fading.length})
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="rounded-md border mt-2">
                      <Table>
                        <TableBody>
                          {fading.map((r) => (
                            <TableRow key={r.base_sku} className="text-muted-foreground">
                              {skuCell(r)}
                              <TableCell className="text-right">{nf(r.weekly_velocity, 1)}/wk</TableCell>
                              <TableCell className="text-right">30d: {nf(r.units_30d)}</TableCell>
                              <TableCell className="text-right">to order {nf(r.units_to_order)}</TableCell>
                              <TableCell className="text-right">{gbp(r.reorder_cost)}</TableCell>
                              <TableCell>{rowActions(r)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
              <p className="text-xs text-muted-foreground">
                FBM Δ compares like for like: FBM handling assumed at £{handlingCfg.handling.toFixed(2)}/order
                (assumption — tune in app_settings → amazon.fbm_vs_fba, along with the review thresholds of
                ≥£{handlingCfg.minGbp.toFixed(2)}/unit and ≥{handlingCfg.minPct}%). The "Review" flag is
                information for a human decision only — it never snoozes or deprioritises a line.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Candidates ---------------- */}
        <TabsContent value="candidates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>FBA Candidates — decision list, not a send-in list</CardTitle>
              <CardDescription>
                Never been in FBA; velocity ≥ 3/wk, ≥ 8 units/30d, FBA net beats FBM net, not excluded.
                First send = 4 weeks × velocity × account FBA share, case-rounded, capped at Coleraine.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {filterBar}
              {isLoading ? (
                <PageLoader rows={8} columns={[180, 70, 70, 90, 90, 70, 70, 90, 80]} label="Loading candidates" />
              ) : (
                <div className="rounded-md border [&>div]:max-h-[65vh] [&>div]:overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow>
                        <SortHead field="base_sku" label="SKU" />
                        <SortHead field="weekly_velocity" label="Vel/wk" className="text-right" />
                        <SortHead field="units_30d" label="30d" className="text-right" />
                        <SortHead field="fbm_net_per_unit" label="FBM net £/u" className="text-right" />
                        <SortHead field="fba_net_per_unit_eff" label="FBA net £/u" className="text-right" />
                        <SortHead field="net_diff" label="Diff" className="text-right" />
                        <TableHead className="text-right" title="Extra FBA volume needed for FBA total contribution to match FBM at current velocity">BE uplift</TableHead>
                        <TableHead>Verdict</TableHead>
                        <TableHead className="text-right">FBA POR%</TableHead>
                        <TableHead className="text-right">Contrib £/wk*</TableHead>
                        <SortHead field="coleraine_available" label="Coleraine" className="text-right" />
                        <SortHead field="suggested_first_send" label="First send" className="text-right" />
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {candidates.length === 0 ? (
                        <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                          No candidates pass the gates{rows.some((r) => r.fee_source == null && !r.ever_fba) ? " (candidate economics need the nightly refresh / fee data)" : ""}
                        </TableCell></TableRow>
                      ) : candidates.map((r) => {
                        const por = r.fbm_price_gross ? ((r.fba_net_per_unit_eff ?? 0) / r.fbm_price_gross) * 100 : null;
                        return (
                          <TableRow key={r.base_sku}>
                            {skuCell(r)}
                            <TableCell className="text-right font-medium">{nf(r.weekly_velocity, 1)}</TableCell>
                            <TableCell className="text-right">{nf(r.units_30d)}</TableCell>
                            <TableCell className="text-right tabular-nums">{gbp(r.fbm_net_per_unit)}</TableCell>
                            <TableCell className="text-right tabular-nums" title={`Fee source: ${r.fee_source ?? "—"}${r.fee_source === "modelled" ? " (estimate from observed FBA fees — Fees API pending Pricing role)" : ""}`}>
                              {gbp(r.fba_net_per_unit_eff)}{r.fee_source === "modelled" ? <span className="text-muted-foreground">*</span> : null}
                            </TableCell>
                            <TableCell className={`text-right tabular-nums font-medium ${(r.net_diff ?? 0) > 0 ? "text-green-600" : "text-red-500"}`}>{gbp(r.net_diff)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {(() => { const u = upliftPct(r); return u == null ? "—" : u === 0 ? "0%" : `+${nf(u)}%`; })()}
                            </TableCell>
                            <TableCell>
                              {r.is_candidate
                                ? <Badge className="bg-green-600">Send candidate</Badge>
                                : <Badge variant="outline" className="border-blue-400 text-blue-600" title="FBA is profitable but behind FBM per unit — a Prime-uplift trial, not a send">Test candidate</Badge>}
                            </TableCell>
                            <TableCell className={`text-right tabular-nums ${porBandClass(por, bands ?? null)}`}>{por == null ? "—" : `${nf(por, 1)}%`}</TableCell>
                            <TableCell className="text-right tabular-nums" title="If volume holds">{gbp((r.fba_net_per_unit_eff ?? 0) * (r.weekly_velocity ?? 0))}</TableCell>
                            <TableCell className="text-right">{r.coleraine_placeholder ? "0*" : nf(r.coleraine_available)}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {r.base_sku in selected ? (
                                <Input type="number" min={0} className="w-16 h-7 text-right inline-block"
                                  value={selected[r.base_sku]}
                                  onChange={(e) => setSelected((p) => ({ ...p, [r.base_sku]: Math.max(0, Number(e.target.value) || 0) }))} />
                              ) : nf(r.suggested_first_send)}
                            </TableCell>
                            <TableCell>{rowActions(r)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="text-xs text-muted-foreground">* Contribution/wk assumes current velocity holds. FBA net marked * uses a modelled fee until the Fees API (Pricing role) is live.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Deferred ---------------- */}
        <TabsContent value="deferred">
          <Card>
            <CardHeader>
              <CardTitle>Deferred</CardTitle>
              <CardDescription>Never-send exclusions and active snoozes. Snoozed SKUs return automatically on their date — or early if they stock out at FBA while still selling at their original pace.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead><TableHead>ASIN</TableHead><TableHead>Type</TableHead><TableHead>Reason / note</TableHead>
                    <TableHead className="text-right">Price at defer</TableHead><TableHead className="text-right">Current</TableHead>
                    <TableHead>Raise status</TableHead>
                    <TableHead>Who</TableHead><TableHead>When</TableHead><TableHead>Returns</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(deferred ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Nothing deferred</TableCell></TableRow>
                  ) : (deferred ?? []).map((d: any) => (
                    <TableRow key={`${d.kind}-${d.base_sku}`} className={d.ready_review ? "bg-amber-500/5" : undefined}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {d.base_sku}
                        {d.ready_review && (
                          <Badge variant="outline" className="ml-1.5 text-[10px] border-amber-500 text-amber-600"
                            title={d.raise_status === "applied" ? "The queued price rise has gone live — check whether it held" : "Returns within 7 days"}>
                            Ready to review
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {d.asin ? (
                          <a href={`https://www.amazon.co.uk/dp/${d.asin}`} target="_blank" rel="noreferrer"
                            className="text-primary underline-offset-2 hover:underline font-mono text-xs">{d.asin}</a>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.kind === "never" ? "destructive" : "outline"}>
                          {d.kind === "never" ? "Never" : d.kind === "raise_hold" ? "Raise held" : d.kind === "not_now" ? "Not now" : "Snoozed"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-sm">
                        <div className="text-sm">{d.reason ?? ""}</div>
                        <div className="text-xs text-muted-foreground">{d.note ?? ""}</div>
                        {d.kind !== "never" && snoozeMap.get(d.base_sku)?.context?.action?.startsWith("delay_raise") && (
                          <div className="text-xs mt-1">
                            {gbp(snoozeMap.get(d.base_sku)?.context?.old_price)} → {gbp(snoozeMap.get(d.base_sku)?.context?.new_price ?? snoozeMap.get(d.base_sku)?.context?.suggested_price)}
                            {" · "}{nf(snoozeMap.get(d.base_sku)?.context?.units_wk, 1)}/wk · {gbp(snoozeMap.get(d.base_sku)?.context?.profit_wk)}/wk before
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{gbp(d.price_at_defer)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {gbp(d.current_price)}
                        {d.price_at_defer != null && d.current_price != null && d.current_price !== d.price_at_defer && (
                          <span className={`ml-1 text-xs ${d.current_price > d.price_at_defer ? "text-green-600" : "text-red-500"}`}>
                            ({d.current_price > d.price_at_defer ? "+" : ""}{nf(((d.current_price - d.price_at_defer) / d.price_at_defer) * 100, 0)}%)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {d.raise_status ? (
                          <Badge variant={d.raise_status === "applied" ? "default" : "outline"}
                            className={d.raise_status === "held >20%" ? "border-amber-500 text-amber-600" : undefined}>
                            {d.raise_status}
                          </Badge>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">{d.set_by ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{d.set_at ? new Date(d.set_at).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-sm">{d.until_date ? new Date(d.until_date).toLocaleDateString() : "—"}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => undeferMutation.mutate(d.base_sku)}>
                          <Undo2 className="h-3.5 w-3.5 mr-1" />Un-defer
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Batches ---------------- */}
        <TabsContent value="batches">
          <Card>
            <CardHeader>
              <CardTitle>Send-in batches</CardTitle>
              <CardDescription>pending → seen at Amazon → received. Pending units count as in-transit. Batches not seen within 14 days are flagged (and emailed in the daily health alert).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(batches ?? []).length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No send-in batches yet</p>
              ) : (batches ?? []).map((b: any) => (
                <Collapsible key={b.id}>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm"><ChevronDown className="h-4 w-4" /></Button>
                      </CollapsibleTrigger>
                      <div>
                        <div className="text-sm font-medium">
                          {new Date(b.created_at).toLocaleString()} · {b.skus} SKUs · {b.units} units
                          {b.overdue && <Badge variant="destructive" className="ml-2">overdue — not seen in 14d</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{b.created_by} · {b.note ?? ""}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={b.status === "pending" ? "outline" : b.status === "expired" ? "destructive" : "default"}>{b.status}</Badge>
                      {b.status === "pending" && (
                        <Button size="sm" variant="ghost" onClick={() => cancelBatchMutation.mutate(b.id)}>Cancel</Button>
                      )}
                    </div>
                  </div>
                  <CollapsibleContent>
                    <div className="ml-10 mt-1 mb-2 text-sm text-muted-foreground">
                      {(b.lines ?? []).map((l: any) => (
                        <div key={l.base_sku} className="flex gap-4">
                          <span className="font-mono">{l.base_sku}</span>
                          <span>{l.amazon_seller_sku}</span>
                          <span>{l.asin}</span>
                          <span>×{l.qty}</span>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---------------- sticky selection bar ---------------- */}
      {selTotals.skus > 0 && (tab === "replenish" || tab === "candidates") && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card/95 backdrop-blur px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3 max-w-[1400px] mx-auto">
            <div className="flex items-center gap-5 text-sm">
              <span className="font-semibold">{selTotals.skus} SKUs</span>
              <span>{nf(selTotals.units)} units</span>
              <span>{gbp(selTotals.cost)} at cost</span>
              <span title="If volume holds">{gbp(selTotals.contribWk)}/wk contribution</span>
              {selBlocked.length > 0 && (
                <span className="text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />{selBlocked.length} blocked (hazmat / no FBA SKU)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" size="sm">Bulk actions</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => deferMutation.mutate({ skus: selRows.map((r) => r.base_sku), kind: "snooze", weeks: 4 })}>Snooze 4 weeks</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => deferMutation.mutate({ skus: selRows.map((r) => r.base_sku), kind: "not_now" })}>Not now</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => delayRaiseMutation.mutate(selRows.map((r) => r.base_sku))}>Delay &amp; raise price</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={() => { setDeferReason("other"); setDeferDialog({ skus: selRows.map((r) => r.base_sku), hazmat: selRows.some((r) => r.is_hazmat) }); }}>Never send to FBA…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="sm" onClick={() => setSelected({})}>Clear</Button>
              <Button size="sm" onClick={() => setSendDialogOpen(true)} disabled={selTotals.units === 0}>
                <Truck className="h-4 w-4 mr-1" />Create send-in
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Never-send dialog ---------------- */}
      <Dialog open={!!deferDialog} onOpenChange={() => setDeferDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Never send to FBA</DialogTitle>
            <DialogDescription>
              {deferDialog?.hazmat ? "This line is hazmat-flagged — confirm it should never be sent to FBA. " : ""}
              {deferDialog?.skus.length === 1 ? deferDialog.skus[0] : `${deferDialog?.skus.length} SKUs`} will be permanently hidden (reversible in the Deferred view).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={deferReason} onValueChange={setDeferReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dangerous_goods">Dangerous goods / hazmat</SelectItem>
                  <SelectItem value="oversize">Oversize</SelectItem>
                  <SelectItem value="restricted_brand">Restricted brand</SelectItem>
                  <SelectItem value="amazon_refused">Amazon refused</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note {deferReason === "other" ? "(required)" : "(optional)"}</Label>
              <Textarea value={deferNote} onChange={(e) => setDeferNote(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeferDialog(null)}>Cancel</Button>
            <Button variant="destructive"
              disabled={deferReason === "other" && !deferNote.trim()}
              onClick={() => deferDialog && deferMutation.mutate({ skus: deferDialog.skus, kind: "never", reason: deferReason, note: deferNote || undefined })}>
              Never send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- Create send-in dialog ---------------- */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create send-in batch</DialogTitle>
            <DialogDescription>
              {selTotals.skus - selBlocked.length} sendable SKUs, {selTotals.units} units, {gbp(selTotals.cost)} at cost.
              {selBlocked.length > 0 && ` ${selBlocked.length} blocked line(s) will be left out: ${selBlocked.map((r) => r.base_sku).join(", ")}.`}
              {" "}This logs the batch (units count as in-transit immediately) and downloads the Amazon upload file + warehouse pick list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)}>Cancel</Button>
            <Button onClick={createSendIn}><Download className="h-4 w-4 mr-1" />Create &amp; download</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FbaReplenishment;
