import { useEffect, useMemo, useState } from "react";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSidebar } from "@/components/ui/sidebar";
import { PageLoader } from "@/components/ui/PageLoader";
import ModuleHeader from "@/components/ModuleHeader";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowUpDown, Truck, Download, AlertTriangle, MoreHorizontal, ChevronDown,
  Flame, PackageX, Clock, TrendingUp, Undo2, ExternalLink, Columns3, Rows3,
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
const lsGet = (k: string, fallback: string) => {
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
};
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

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

/** Tiny cover bar: weeks of cover against the 6-week target. */
const CoverBar = ({ weeks }: { weeks: number | null }) => {
  const pct = weeks == null ? 0 : Math.min(100, (weeks / 6) * 100);
  const color = weeks == null || weeks < 2 ? "bg-red-500" : weeks < 4 ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="w-16 h-1.5 rounded bg-muted overflow-hidden" title={`${nf(weeks, 1)} weeks of 6-week target`}>
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
};

/** Inline SVG sparkline for weekly values. */
const Sparkline = ({ points }: { points: number[] }) => {
  if (!points.length) return <span className="text-xs text-muted-foreground">no sales data</span>;
  const max = Math.max(...points, 1);
  const w = 220, h = 40, step = w / Math.max(points.length - 1, 1);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="text-primary">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {points.map((v, i) => (
        <circle key={i} cx={i * step} cy={h - (v / max) * (h - 4) - 2} r="1.5" fill="currentColor" />
      ))}
    </svg>
  );
};

const FbaReplenishment = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const sidebar = useSidebar();

  // Collapse the left nav by default on this page (decision screen wants width).
  useEffect(() => { sidebar.setOpen(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ---- URL-backed filters ---------------------------------------------------
  const tab = params.get("tab") ?? "replenish";
  const search = params.get("q") ?? "";
  const brandFilter = (params.get("brand") ?? "").split(",").filter(Boolean);
  const mkt = params.get("mkt") ?? "all";
  const minVel = Number(params.get("minvel") ?? 0) || 0;
  const minNet = params.get("minnet") ? Number(params.get("minnet")) : null;
  const hideFading = params.get("fading") !== "show";
  const csnOnly = params.get("csn") === "1";
  const buyFirstOnly = params.get("buyfirst") === "1";
  const dgOnly = params.get("dg") === "1";
  const fbmRevOnly = params.get("fbmrev") === "1";
  const uplift50Only = params.get("uplift") === "50";
  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v == null || v === "" || v === "all") p.delete(k); else p.set(k, v);
    setParams(p, { replace: true });
  };
  const toggleParam = (k: string) => setParam(k, params.get(k) === "1" ? null : "1");

  const [sort, setSort] = useState<{ field: SortField; dir: "asc" | "desc" }>({ field: "reorder_cost", dir: "desc" });
  const [selected, setSelected] = useState<Record<string, number>>({}); // base_sku -> qty
  const [deferDialog, setDeferDialog] = useState<{ skus: string[]; hazmat: boolean } | null>(null);
  const [deferReason, setDeferReason] = useState("dangerous_goods");
  const [deferNote, setDeferNote] = useState("");
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [drawerSku, setDrawerSku] = useState<string | null>(null);
  const [density, setDensityState] = useState<"comfortable" | "compact">(() => (lsGet("fba-density", "comfortable") as any));
  const [viewMode, setViewModeState] = useState<"grouped" | "classic">(() => (lsGet("fba-columns", "grouped") as any));
  const setDensity = (d: "comfortable" | "compact") => { setDensityState(d); lsSet("fba-density", d); };
  const setViewMode = (m: "grouped" | "classic") => { setViewModeState(m); lsSet("fba-columns", m); };
  const cellPad = density === "compact" ? "py-1" : "py-2.5";

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

  // Drawer-only data (fetched on open).
  const { data: weekly, isError: weeklyError, isLoading: weeklyLoading, refetch: refetchWeekly } = useQuery({
    queryKey: ["fba-sku-weekly", drawerSku],
    enabled: !!drawerSku,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("amazon_fba_sku_weekly", { p_base_sku: drawerSku });
      if (error) throw error;
      return (data ?? []) as { week_start: string; units: number }[];
    },
  });
  const { data: queueRows, isError: queueError } = useQuery({
    queryKey: ["fba-sku-queue", drawerSku],
    enabled: !!drawerSku,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("threeds_reprice_pending")
        .select("store_id, price, status, queued_at, source")
        .eq("sku", drawerSku).order("queued_at", { ascending: false }).limit(10);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

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

  // ---- derived rows (calculations unchanged) --------------------------------
  const rows = data ?? [];
  const dataAsOf = rows.length > 0 ? rows[0].data_as_of : null;
  const rowsBySku = useMemo(() => new Map(rows.map((r) => [r.base_sku, r])), [rows]);
  const drawerRow = drawerSku ? rowsBySku.get(drawerSku) ?? null : null;
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

  // Break-even Prime uplift: extra FBA volume needed for FBA total contribution
  // to match FBM at current velocity. Only meaningful when FBA net > 0.
  const upliftPct = (r: Row): number | null => {
    const fba = r.fba_net_per_unit_eff, fbm = r.fbm_net_per_unit;
    if (fba == null || fbm == null || fba <= 0) return null;
    if ((r.net_diff ?? 0) > 0) return 0; // FBA already wins per unit
    return Math.round((fbm / fba - 1) * 100);
  };

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

  const applyCommonFilters = (list: Row[]) => {
    let out = list;
    if (brandFilter.length) out = out.filter((r) => brandFilter.includes(brandOf(r.base_sku)));
    if (mkt !== "all") out = out.filter((r) => r.country_code === mkt);
    if (minVel > 0) out = out.filter((r) => (r.weekly_velocity ?? 0) >= minVel);
    if (minNet != null) out = out.filter((r) => (r.net_margin_pct ?? -999) >= minNet);
    if (csnOnly) out = out.filter((r) => (r.can_send_now ?? 0) > 0);
    if (buyFirstOnly) out = out.filter((r) => r.buy_first);
    if (dgOnly) out = out.filter((r) => r.is_hazmat);
    if (fbmRevOnly) out = out.filter((r) => fbmReviewFlag(r));
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
    [rows, snoozeMap, brandFilter.join(","), mkt, minVel, minNet, csnOnly, buyFirstOnly, dgOnly, fbmRevOnly, search, fbmCfg],
  );
  const fading = useMemo(() => replenishAll.filter((r) => !r.units_30d), [replenishAll]);
  const replenish = useMemo(
    () => sortRows(hideFading ? replenishAll.filter((r) => !!r.units_30d) : replenishAll),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replenishAll, hideFading, sort],
  );

  const candidates = useMemo(
    () => sortRows(applyCommonFilters(rows.filter((r) => {
      if (r.ever_fba || r.is_excluded || isHidden(r)) return false;
      const preFilter = (r.weekly_velocity ?? 0) >= 3 && (r.units_30d ?? 0) >= 8;
      if (!preFilter) return false;
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
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tab, snoozeMap]);

  const countries = useMemo(
    () => Array.from(new Set(rows.map((r) => r.country_code).filter(Boolean))).sort() as string[],
    [rows],
  );

  // Summary card stats (over the unfiltered replenish universe so cards act as filters).
  const cardStats = useMemo(() => {
    const base = rows.filter((r) => r.ever_fba && r.replenish_flag && !isHidden(r));
    return {
      lines: base.length,
      canSendUnits: base.reduce((a, r) => a + (r.can_send_now ?? 0), 0),
      reorderGbp: base.reduce((a, r) => a + (r.reorder_cost ?? 0), 0),
      buyFirst: base.filter((r) => r.buy_first).length,
      dg: base.filter((r) => r.is_hazmat).length,
      fbmReview: base.filter((r) => fbmReviewFlag(r)).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, snoozeMap, fbmCfg]);

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
    const { error } = await (supabase as any).rpc("amazon_fba_create_send_batch", {
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

  // ---- render helpers -------------------------------------------------------
  const toggleSort = (field: SortField) =>
    setSort((p) => ({ field, dir: p.field === field && p.dir === "desc" ? "asc" : "desc" }));
  const SortHead = ({ field, label, className }: { field: SortField; label: string; className?: string }) => (
    <TableHead className={className}>
      <Button variant="ghost" size="sm" onClick={() => toggleSort(field)} className="h-7 px-1.5 -ml-1.5 whitespace-nowrap text-xs">
        {label}<ArrowUpDown className="ml-1 h-3 w-3" />
      </Button>
    </TableHead>
  );

  const inTransitTitle = (r: Row) =>
    `Working ${nf(r.fba_inbound_working)} · Shipped ${nf(r.fba_inbound_shipped)} · Receiving ${nf(r.fba_inbound_receiving)} · Pending send ${nf(r.pending_send_units)} · Shipment (not yet in feed) ${nf(r.shipment_extra_units)}`;

  const firstAsin = (r: Row) => (r.asins ?? "").split(", ")[0] || null;

  const rowActions = (r: Row) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs">{r.base_sku}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {firstAsin(r) && (
          <DropdownMenuItem onClick={() => window.open(`https://www.amazon.co.uk/dp/${firstAsin(r)}`, "_blank")}>
            <ExternalLink className="h-3.5 w-3.5 mr-2" />Open on Amazon
          </DropdownMenuItem>
        )}
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

  const rowBadges = (r: Row, opts?: { fading?: boolean }) => (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {r.buy_first && <Badge variant="outline" className="text-[9px] px-1 border-orange-400 text-orange-600" title="Units to order exceed Coleraine availability">buy first</Badge>}
      {r.is_hazmat && (
        <Badge variant="outline" className="text-[9px] px-1 border-amber-500 text-amber-600 cursor-pointer"
          title={`Flagged ${r.hazmat_source === "keyword" ? "by title keywords" : "as dangerous goods"} — click to review "Never send"`}
          onClick={(e) => { e.stopPropagation(); setDeferReason("dangerous_goods"); setDeferDialog({ skus: [r.base_sku], hazmat: true }); }}>
          <Flame className="h-2.5 w-2.5 mr-0.5" />DG?
        </Badge>
      )}
      {fbmReviewFlag(r) && <Badge variant="outline" className="text-[9px] px-1 border-amber-500 text-amber-600">Review: FBM</Badge>}
      {!r.amazon_seller_sku && <Badge variant="outline" className="text-[9px] px-1 border-red-400 text-red-500" title="No Amazon seller SKU with FBA history — cannot be put on a send-in file">no FBA SKU</Badge>}
      {opts?.fading && <Badge variant="outline" className="text-[9px] px-1 text-muted-foreground" title="No sales in the last 30 days">fading</Badge>}
    </span>
  );

  /** Grouped cell 1: sticky Product cell. */
  const productCell = (r: Row, opts?: { fading?: boolean }) => (
    <TableCell className={`sticky left-0 z-10 bg-card ${cellPad} min-w-[230px] max-w-[260px] border-r`}
      onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-1.5">
        <Checkbox className="mt-0.5" checked={r.base_sku in selected} onCheckedChange={(v) => toggleSelect(r, !!v)} />
        <div className="min-w-0 cursor-pointer" onClick={() => setDrawerSku(r.base_sku)}>
          <div className="font-medium text-sm leading-tight whitespace-nowrap">
            {r.base_sku}
            {r.country_code && r.country_code !== "GB" && <Badge variant="outline" className="ml-1 text-[9px] px-1">{r.country_code}</Badge>}
          </div>
          <div className="text-[11px] text-muted-foreground truncate leading-tight">{r.title ?? "—"}</div>
          {rowBadges(r, opts)}
        </div>
      </div>
    </TableCell>
  );

  const groupedReplenishRow = (r: Row, opts?: { fading?: boolean }) => {
    const por = r.avg_sell_price ? ((r.net_per_unit ?? 0) / (r.avg_sell_price * 1.2)) * 100 : null;
    const adj = fbmNetAdj(r);
    const head = volumeLossHeadroom(r);
    return (
      <TableRow key={r.base_sku} className="cursor-pointer" onClick={() => setDrawerSku(r.base_sku)}>
        {productCell(r, opts)}
        <TableCell className={`text-right ${cellPad}`}>
          <div className="font-semibold tabular-nums">{nf(r.weekly_velocity, 1)}<span className="text-[10px] font-normal text-muted-foreground">/wk</span></div>
          <div className="text-[11px] text-muted-foreground">30d: {nf(r.units_30d)}</div>
        </TableCell>
        <TableCell className={`text-right ${cellPad}`}>
          <div className="font-semibold tabular-nums">{(r.fba_on_hand ?? 0) === 0 ? <span className="text-red-500">0</span> : nf(r.fba_on_hand)}</div>
          <div className="text-[11px] text-muted-foreground whitespace-nowrap" title={inTransitTitle(r)}>
            {(r.fba_reserved ?? 0) > 0 && <>+{nf(r.fba_reserved)} res · </>}+{nf(r.fba_in_transit)} inbound
          </div>
        </TableCell>
        <TableCell className={`${cellPad}`}>
          <div className="text-sm tabular-nums">{nf(r.days_of_cover_weeks, 1)}w</div>
          <CoverBar weeks={r.days_of_cover_weeks} />
        </TableCell>
        <TableCell className={`text-right ${cellPad}`} onClick={(e) => r.base_sku in selected && e.stopPropagation()}>
          {r.base_sku in selected ? (
            <Input type="number" min={0} className="w-16 h-7 text-right inline-block font-semibold"
              value={selected[r.base_sku]}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setSelected((p) => ({ ...p, [r.base_sku]: Math.max(0, Number(e.target.value) || 0) }))} />
          ) : (
            <div className="font-semibold tabular-nums">{nf(r.can_send_now)}</div>
          )}
          <div className="text-[11px] text-muted-foreground whitespace-nowrap">
            of {nf(r.units_to_order)} · Col {r.coleraine_placeholder ? "0*" : nf(r.coleraine_available)}
          </div>
        </TableCell>
        <TableCell className={`text-right ${cellPad}`}
          title={[
            `FBA net ${gbp(r.fba_net_per_unit_eff)}/unit (fee source: ${r.fee_source ?? "—"})`,
            adj != null ? `FBM net ${gbp(r.fbm_net_per_unit)} before handling, ${gbp(adj)} after (£${handlingCfg.handling.toFixed(2)}/order — assumption)` : null,
            head != null && head > 0 ? `FBM stays better until ~${nf(head)}% of Amazon volume is lost to the missing Prime badge` : null,
          ].filter(Boolean).join("\n")}>
          <div className={`font-semibold tabular-nums ${porBandClass(por, bands ?? null)}`}>
            {gbp(r.net_per_unit)}{por != null && <span className="text-[10px] font-normal ml-1">{nf(por, 0)}%</span>}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">FBM Δ {r.net_diff == null ? "—" : gbp(r.net_diff)}</div>
        </TableCell>
        <TableCell className={`text-right ${cellPad}`} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            <div>
              <div className="font-semibold tabular-nums">{gbp(r.reorder_cost)}</div>
              <div className="text-[11px] text-muted-foreground">at cost</div>
            </div>
            {rowActions(r)}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const groupedHeader = (
    <TableRow>
      <TableHead className="sticky left-0 z-20 bg-card border-r min-w-[230px]">Product</TableHead>
      <SortHead field="weekly_velocity" label="Sales" className="text-right" />
      <SortHead field="fba_on_hand" label="FBA stock" className="text-right" />
      <SortHead field="days_of_cover_weeks" label="Cover" />
      <SortHead field="can_send_now" label="Send" className="text-right" />
      <SortHead field="net_per_unit" label="Money" className="text-right" />
      <SortHead field="reorder_cost" label="Value" className="text-right" />
    </TableRow>
  );

  const groupedCandidateRow = (r: Row) => {
    const por = r.fbm_price_gross ? ((r.fba_net_per_unit_eff ?? 0) / r.fbm_price_gross) * 100 : null;
    const u = upliftPct(r);
    return (
      <TableRow key={r.base_sku} className="cursor-pointer" onClick={() => setDrawerSku(r.base_sku)}>
        {productCell(r)}
        <TableCell className={`text-right ${cellPad}`}>
          <div className="font-semibold tabular-nums">{nf(r.weekly_velocity, 1)}<span className="text-[10px] font-normal text-muted-foreground">/wk</span></div>
          <div className="text-[11px] text-muted-foreground">30d: {nf(r.units_30d)}</div>
        </TableCell>
        <TableCell className={`text-right ${cellPad}`}
          title={`Fee source: ${r.fee_source ?? "—"}${r.fee_source === "modelled" ? " (estimate from observed FBA fees)" : ""}`}>
          <div className="font-semibold tabular-nums">
            FBA {gbp(r.fba_net_per_unit_eff)}{r.fee_source === "modelled" ? "*" : ""}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">FBM {gbp(r.fbm_net_per_unit)} · Δ {gbp(r.net_diff)}</div>
        </TableCell>
        <TableCell className={`${cellPad}`}>
          <div className="font-semibold tabular-nums">{u == null ? "—" : u === 0 ? "0%" : `+${nf(u)}%`}</div>
          {r.is_candidate
            ? <Badge className="bg-green-600 text-[9px] px-1">Send candidate</Badge>
            : <Badge variant="outline" className="text-[9px] px-1 border-blue-400 text-blue-600" title="FBA is profitable but behind FBM per unit — a Prime-uplift trial, not a send">Test candidate</Badge>}
        </TableCell>
        <TableCell className={`text-right ${cellPad}`} onClick={(e) => r.base_sku in selected && e.stopPropagation()}>
          {r.base_sku in selected ? (
            <Input type="number" min={0} className="w-16 h-7 text-right inline-block font-semibold"
              value={selected[r.base_sku]}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setSelected((p) => ({ ...p, [r.base_sku]: Math.max(0, Number(e.target.value) || 0) }))} />
          ) : (
            <div className="font-semibold tabular-nums">{nf(r.suggested_first_send)}</div>
          )}
          <div className="text-[11px] text-muted-foreground">first send · Col {r.coleraine_placeholder ? "0*" : nf(r.coleraine_available)}</div>
        </TableCell>
        <TableCell className={`text-right ${cellPad}`} title="If volume holds">
          <div className={`font-semibold tabular-nums ${porBandClass(por, bands ?? null)}`}>
            {gbp((r.fba_net_per_unit_eff ?? 0) * (r.weekly_velocity ?? 0))}<span className="text-[10px] font-normal">/wk</span>
          </div>
          <div className="text-[11px] text-muted-foreground">{por == null ? "—" : `POR ${nf(por, 1)}%`}</div>
        </TableCell>
        <TableCell className={`text-right ${cellPad}`} onClick={(e) => e.stopPropagation()}>{rowActions(r)}</TableCell>
      </TableRow>
    );
  };

  // ---- classic (old separate-columns) renderers -----------------------------
  const classicReplenishRow = (r: Row) => {
    const por = r.avg_sell_price ? ((r.net_per_unit ?? 0) / (r.avg_sell_price * 1.2)) * 100 : null;
    const adj = fbmNetAdj(r);
    const head = volumeLossHeadroom(r);
    return (
      <TableRow key={r.base_sku} className="cursor-pointer" onClick={() => setDrawerSku(r.base_sku)}>
        {productCell(r)}
        <TableCell className={`text-right font-medium ${cellPad}`}>{nf(r.weekly_velocity, 1)}</TableCell>
        <TableCell className={`text-right ${cellPad}`}>{nf(r.units_30d)}</TableCell>
        <TableCell className={`text-right ${cellPad}`}>{(r.fba_on_hand ?? 0) === 0 ? <Badge variant="destructive">0</Badge> : nf(r.fba_on_hand)}</TableCell>
        <TableCell className={`text-right text-muted-foreground ${cellPad}`}>{nf(r.fba_reserved)}</TableCell>
        <TableCell className={`text-right ${cellPad}`} title={inTransitTitle(r)}>{nf(r.fba_in_transit)}</TableCell>
        <TableCell className={`text-right ${cellPad}`}>{nf(r.days_of_cover_weeks, 1)}</TableCell>
        <TableCell className={`text-right font-semibold tabular-nums ${cellPad}`}>{nf(r.units_to_order)}</TableCell>
        <TableCell className={`text-right ${cellPad}`}>{r.coleraine_placeholder ? "0*" : nf(r.coleraine_available)}</TableCell>
        <TableCell className={`text-right ${cellPad}`} onClick={(e) => r.base_sku in selected && e.stopPropagation()}>
          {r.base_sku in selected ? (
            <Input type="number" min={0} className="w-16 h-7 text-right inline-block"
              value={selected[r.base_sku]}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setSelected((p) => ({ ...p, [r.base_sku]: Math.max(0, Number(e.target.value) || 0) }))} />
          ) : nf(r.can_send_now)}
        </TableCell>
        <TableCell className={`text-right tabular-nums text-muted-foreground ${cellPad}`} title={`Fee source: ${r.fee_source ?? "—"}`}>{gbp(r.fba_fee_per_unit)}</TableCell>
        <TableCell className={`text-right tabular-nums ${porBandClass(por, bands ?? null)} ${cellPad}`}>{r.net_margin_pct == null ? "—" : `${nf(r.net_margin_pct, 1)}%`}</TableCell>
        <TableCell className={`text-right tabular-nums whitespace-nowrap ${cellPad}`}
          title={[
            `FBA net ${gbp(r.fba_net_per_unit_eff)}/unit`,
            adj != null ? `FBM net ${gbp(r.fbm_net_per_unit)}/unit before handling, ${gbp(adj)} after (£${handlingCfg.handling.toFixed(2)}/order handling — assumption)` : null,
            head != null && head > 0 ? `FBM stays better until ~${nf(head)}% of Amazon volume is lost to the missing Prime badge` : null,
          ].filter(Boolean).join("\n")}>
          {r.net_diff == null ? "—" : gbp(r.net_diff)}
        </TableCell>
        <TableCell className={`text-right tabular-nums ${cellPad}`}>{gbp(r.reorder_cost)}</TableCell>
        <TableCell className={cellPad} onClick={(e) => e.stopPropagation()}>{rowActions(r)}</TableCell>
      </TableRow>
    );
  };

  const classicHeader = (
    <TableRow>
      <TableHead className="sticky left-0 z-20 bg-card border-r min-w-[230px]">Product</TableHead>
      <SortHead field="weekly_velocity" label="Vel/wk" className="text-right" />
      <SortHead field="units_30d" label="30d" className="text-right" />
      <SortHead field="fba_on_hand" label="On-hand" className="text-right" />
      <SortHead field="fba_reserved" label="Reserved" className="text-right" />
      <SortHead field="fba_in_transit" label="In-transit" className="text-right" />
      <SortHead field="days_of_cover_weeks" label="Wks" className="text-right" />
      <SortHead field="units_to_order" label="To order" className="text-right" />
      <SortHead field="coleraine_available" label="Coleraine" className="text-right" />
      <SortHead field="can_send_now" label="Can send" className="text-right" />
      <SortHead field="fba_fee_per_unit" label="FBA £" className="text-right" />
      <SortHead field="net_margin_pct" label="Net %" className="text-right" />
      <SortHead field="net_diff" label="FBM Δ" className="text-right" />
      <SortHead field="reorder_cost" label="Reorder £" className="text-right" />
      <TableHead />
    </TableRow>
  );

  const filterBar = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Input placeholder="Search SKU / title…" value={search} onChange={(e) => setParam("q", e.target.value)} className="w-48 h-8 text-sm" />
      {countries.length > 1 && (
        <select value={mkt} onChange={(e) => setParam("mkt", e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm">
          <option value="all">All marketplaces</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            Brands{brandFilter.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px]">{brandFilter.length}</Badge>}
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 max-h-80 overflow-auto p-2" align="start">
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
        </PopoverContent>
      </Popover>
      <div className="flex items-center gap-1 text-sm">
        <Label htmlFor="minvel" className="text-xs text-muted-foreground">Vel ≥</Label>
        <Input id="minvel" type="number" min={0} step={0.5} value={minVel || ""} placeholder="0"
          onChange={(e) => setParam("minvel", e.target.value)} className="w-14 h-8" />
      </div>
      <div className="flex items-center gap-1 text-sm">
        <Label htmlFor="minnet" className="text-xs text-muted-foreground">Net% ≥</Label>
        <Input id="minnet" type="number" step={1} value={minNet ?? ""} placeholder="—"
          onChange={(e) => setParam("minnet", e.target.value)} className="w-14 h-8" />
      </div>
      <div className="flex items-center gap-1.5">
        <Switch id="csn" checked={csnOnly} onCheckedChange={(v) => setParam("csn", v ? "1" : null)} />
        <Label htmlFor="csn" className="text-xs">Can send now</Label>
      </div>
      <div className="flex items-center gap-1.5">
        <Switch id="fading" checked={!hideFading} onCheckedChange={(v) => setParam("fading", v ? "show" : null)} />
        <Label htmlFor="fading" className="text-xs">Fading inline</Label>
      </div>
      {tab === "candidates" && (
        <div className="flex items-center gap-1.5">
          <Switch id="uplift50" checked={uplift50Only} onCheckedChange={(v) => setParam("uplift", v ? "50" : null)} />
          <Label htmlFor="uplift50" className="text-xs">BE uplift ≤ 50%</Label>
        </div>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="outline" size="sm" className="h-8" title="Density"
          onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}>
          <Rows3 className="h-3.5 w-3.5 mr-1" />{density === "compact" ? "Compact" : "Comfortable"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8"><Columns3 className="h-3.5 w-3.5 mr-1" />Columns</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setViewMode("grouped")}>{viewMode === "grouped" ? "✓ " : ""}Grouped (default)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setViewMode("classic")}>{viewMode === "classic" ? "✓ " : ""}Classic columns</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" className="h-8" onClick={selectAllFiltered}>Select all</Button>
      </div>
    </div>
  );

  const summaryCard = (label: string, value: string, opts?: { filterKey?: string; active?: boolean; tone?: string }) => (
    <Card key={label}
      className={`${opts?.filterKey ? "cursor-pointer" : ""} transition-colors ${opts?.active ? "border-primary bg-primary/5" : ""}`}
      onClick={() => opts?.filterKey && toggleParam(opts.filterKey)}>
      <CardHeader className="p-3 pb-2">
        <CardDescription className={`text-xs ${opts?.tone ?? ""}`}>{label}</CardDescription>
        <CardTitle className="text-xl leading-none">{value}</CardTitle>
      </CardHeader>
    </Card>
  );

  return (
    <div className="space-y-4 pb-24">
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
                Refresh the page to try again; if it persists, the nightly snapshot may need attention.
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
        <TabsContent value="replenish" className="space-y-3">
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
            {summaryCard("Lines to reorder", nf(cardStats.lines))}
            {summaryCard("Units can send now", nf(cardStats.canSendUnits), { filterKey: "csn", active: csnOnly })}
            {summaryCard("Reorder £ at cost", gbp(cardStats.reorderGbp))}
            {summaryCard("Buy first", nf(cardStats.buyFirst), { filterKey: "buyfirst", active: buyFirstOnly, tone: "text-orange-600" })}
            {summaryCard("DG flagged", nf(cardStats.dg), { filterKey: "dg", active: dgOnly, tone: "text-amber-600" })}
            {summaryCard("Review: FBM", nf(cardStats.fbmReview), { filterKey: "fbmrev", active: fbmRevOnly, tone: "text-amber-600" })}
          </div>

          <Card>
            <CardContent className="pt-4 space-y-3">
              {filterBar}
              {isLoading ? (
                <PageLoader rows={12} columns={[230, 90, 90, 80, 90, 100, 100]} label="Loading replenishment" />
              ) : (
                <div className="rounded-md border overflow-x-auto [&>div]:max-h-[62vh] [&>div]:overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                      {viewMode === "grouped" ? groupedHeader : classicHeader}
                    </TableHeader>
                    <TableBody>
                      {replenish.length === 0 ? (
                        <TableRow><TableCell colSpan={15} className="text-center py-8 text-muted-foreground">No SKUs match</TableCell></TableRow>
                      ) : replenish.map((r) => (viewMode === "grouped" ? groupedReplenishRow(r) : classicReplenishRow(r)))}
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
                    <div className="rounded-md border mt-2 overflow-x-auto">
                      <Table>
                        <TableBody>
                          {fading.map((r) => groupedReplenishRow(r, { fading: true }))}
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
        <TabsContent value="candidates" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">FBA Candidates — decision list, not a send-in list</CardTitle>
              <CardDescription>
                Never been in FBA; velocity ≥ 3/wk, ≥ 8 units/30d, not excluded. Send candidates beat FBM on
                real/modelled FBA fees; Test candidates are profitable in FBA but need Prime volume uplift (shown) to match FBM.
                First send = 4 weeks × velocity × account FBA share, case-rounded, capped at Coleraine.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {filterBar}
              {isLoading ? (
                <PageLoader rows={8} columns={[230, 90, 110, 90, 100, 100]} label="Loading candidates" />
              ) : (
                <div className="rounded-md border overflow-x-auto [&>div]:max-h-[62vh] [&>div]:overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow>
                        <TableHead className="sticky left-0 z-20 bg-card border-r min-w-[230px]">Product</TableHead>
                        <SortHead field="weekly_velocity" label="Sales" className="text-right" />
                        <SortHead field="net_diff" label="Economics" className="text-right" />
                        <TableHead title="Extra FBA volume needed for FBA total contribution to match FBM at current velocity">BE uplift</TableHead>
                        <SortHead field="suggested_first_send" label="First send" className="text-right" />
                        <TableHead className="text-right">Contrib/wk*</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {candidates.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No candidates pass the gates
                        </TableCell></TableRow>
                      ) : candidates.map(groupedCandidateRow)}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="text-xs text-muted-foreground">* Contribution/wk assumes current velocity holds. FBA net marked * uses a modelled fee.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Deferred ---------------- */}
        <TabsContent value="deferred">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Deferred</CardTitle>
              <CardDescription>Never-send exclusions and active snoozes. Snoozed SKUs return on their date — or early if they stock out at FBA while still selling at their original pace.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-card">
                  <TableRow>
                    <TableHead className="sticky left-0 z-20 bg-card border-r min-w-[230px]">Product</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Prices</TableHead>
                    <TableHead>Raise</TableHead>
                    <TableHead>Who / when</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(deferred ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nothing deferred</TableCell></TableRow>
                  ) : (deferred ?? []).map((d: any) => (
                    <TableRow key={`${d.kind}-${d.base_sku}`} className={d.ready_review ? "bg-amber-500/5" : undefined}>
                      <TableCell className={`sticky left-0 z-10 bg-card border-r min-w-[230px] max-w-[260px] ${cellPad}`}>
                        <div className="font-medium text-sm whitespace-nowrap">
                          {d.base_sku}
                          {d.ready_review && (
                            <Badge variant="outline" className="ml-1.5 text-[9px] px-1 border-amber-500 text-amber-600"
                              title={d.raise_status === "applied" ? "The queued price rise has gone live — check whether it held" : "Returns within 7 days"}>
                              Ready to review
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {d.asin ? (
                            <a href={`https://www.amazon.co.uk/dp/${d.asin}`} target="_blank" rel="noreferrer"
                              className="text-primary underline-offset-2 hover:underline font-mono">{d.asin}</a>
                          ) : "no ASIN"}
                          {d.note ? ` · ${d.note}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className={cellPad}>
                        <Badge variant={d.kind === "never" ? "destructive" : "outline"}>
                          {d.kind === "never" ? "Never" : d.kind === "raise_hold" ? "Raise held" : d.kind === "not_now" ? "Not now" : "Snoozed"}
                        </Badge>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{d.reason ?? ""}{d.until_date ? ` · returns ${new Date(d.until_date).toLocaleDateString()}` : ""}</div>
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${cellPad}`}>
                        <div className="font-medium">{gbp(d.current_price)}
                          {d.price_at_defer != null && d.current_price != null && d.current_price !== d.price_at_defer && (
                            <span className={`ml-1 text-xs ${d.current_price > d.price_at_defer ? "text-green-600" : "text-red-500"}`}>
                              ({d.current_price > d.price_at_defer ? "+" : ""}{nf(((d.current_price - d.price_at_defer) / d.price_at_defer) * 100, 0)}%)
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">at defer: {gbp(d.price_at_defer)}</div>
                      </TableCell>
                      <TableCell className={cellPad}>
                        {d.raise_status ? (
                          <Badge variant={d.raise_status === "applied" ? "default" : "outline"}
                            className={d.raise_status === "held >20%" ? "border-amber-500 text-amber-600" : undefined}>
                            {d.raise_status}
                          </Badge>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className={`text-sm ${cellPad}`}>
                        <div>{d.set_by ?? "—"}</div>
                        <div className="text-[11px] text-muted-foreground">{d.set_at ? new Date(d.set_at).toLocaleDateString() : "—"}</div>
                      </TableCell>
                      <TableCell className={cellPad}>
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
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Send-in batches</CardTitle>
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

      {/* ---------------- row detail drawer ---------------- */}
      <Sheet open={!!drawerSku} onOpenChange={(o) => !o && setDrawerSku(null)}>
        <SheetContent side="right" className="w-[420px] sm:max-w-[420px] overflow-y-auto">
          {drawerRow && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 flex-wrap">
                  {drawerRow.base_sku}
                  {rowBadges(drawerRow)}
                </SheetTitle>
                <SheetDescription>{drawerRow.title ?? "—"}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 mt-4 text-sm">
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">12-week sales (units, pack-normalised)</div>
                  {weeklyError ? (
                    <span className="text-xs text-destructive">
                      couldn't load sales history{" "}
                      <button className="underline" onClick={() => refetchWeekly()}>retry</button>
                    </span>
                  ) : weeklyLoading ? (
                    <span className="text-xs text-muted-foreground">loading…</span>
                  ) : (
                    <Sparkline points={(weekly ?? []).map((w) => Number(w.units))} />
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    Velocity {nf(drawerRow.weekly_velocity, 1)}/wk · 7d {nf(drawerRow.units_7d)} · 30d {nf(drawerRow.units_30d)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="col-span-2 text-xs font-medium text-muted-foreground">FBA stock</div>
                  <div>On-hand</div><div className="text-right font-medium tabular-nums">{nf(drawerRow.fba_on_hand)}</div>
                  <div className="pl-2 text-muted-foreground">of which reserved (FC)</div><div className="text-right tabular-nums">{nf(drawerRow.fba_reserved)}</div>
                  <div>In-transit</div><div className="text-right font-medium tabular-nums">{nf(drawerRow.fba_in_transit)}</div>
                  <div className="pl-2 text-muted-foreground">working</div><div className="text-right tabular-nums">{nf(drawerRow.fba_inbound_working)}</div>
                  <div className="pl-2 text-muted-foreground">shipped</div><div className="text-right tabular-nums">{nf(drawerRow.fba_inbound_shipped)}</div>
                  <div className="pl-2 text-muted-foreground">receiving</div><div className="text-right tabular-nums">{nf(drawerRow.fba_inbound_receiving)}</div>
                  <div className="pl-2 text-muted-foreground">pending send</div><div className="text-right tabular-nums">{nf(drawerRow.pending_send_units)}</div>
                  <div className="pl-2 text-muted-foreground">shipment (not in feed)</div><div className="text-right tabular-nums">{nf(drawerRow.shipment_extra_units)}</div>
                  <div>Weeks cover</div><div className="text-right font-medium tabular-nums">{nf(drawerRow.days_of_cover_weeks, 1)}</div>
                  <div>To order / can send</div><div className="text-right font-medium tabular-nums">{nf(drawerRow.units_to_order)} / {nf(drawerRow.can_send_now)}</div>
                  <div>Coleraine available</div><div className="text-right tabular-nums">{drawerRow.coleraine_placeholder ? "0 (placeholder)" : nf(drawerRow.coleraine_available)}</div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="col-span-2 text-xs font-medium text-muted-foreground">Economics (per unit)</div>
                  <div>FBA net <span className="text-muted-foreground">({drawerRow.fee_source ?? "—"})</span></div>
                  <div className="text-right font-medium tabular-nums">{gbp(drawerRow.fba_net_per_unit_eff)}</div>
                  <div>FBM net before handling</div><div className="text-right tabular-nums">{gbp(drawerRow.fbm_net_per_unit)}</div>
                  <div>FBM net after handling</div><div className="text-right tabular-nums">{gbp(fbmNetAdj(drawerRow))}</div>
                  <div className="pl-2 text-muted-foreground">handling (£{handlingCfg.handling.toFixed(2)}/order, assumption)</div>
                  <div className="text-right tabular-nums text-muted-foreground">
                    {drawerRow.fbm_units_90d ? gbp((handlingCfg.handling * (drawerRow.fbm_orders_90d ?? drawerRow.fbm_units_90d)) / drawerRow.fbm_units_90d) : "—"}
                  </div>
                  <div>Prime volume-loss headroom</div>
                  <div className="text-right tabular-nums">{volumeLossHeadroom(drawerRow) == null ? "—" : `${nf(volumeLossHeadroom(drawerRow))}%`}</div>
                  <div>FBA fee / referral</div>
                  <div className="text-right tabular-nums">{gbp(drawerRow.fba_fee_per_unit)} / {gbp(drawerRow.referral_fee_per_unit)}</div>
                  <div>Cost</div><div className="text-right tabular-nums">{gbp(drawerRow.unit_cost)}</div>
                </div>

                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Amazon</div>
                  {(drawerRow.asins ?? "").split(", ").filter(Boolean).map((a) => (
                    <a key={a} href={`https://www.amazon.co.uk/dp/${a}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 mr-3 text-primary hover:underline font-mono text-xs">
                      {a}<ExternalLink className="h-3 w-3" />
                    </a>
                  ))}
                  <div className="text-xs text-muted-foreground mt-1">Seller SKU: {drawerRow.amazon_seller_sku ?? "—"}</div>
                </div>

                {(batches ?? []).some((b: any) => b.status === "pending" && (b.lines ?? []).some((l: any) => l.base_sku === drawerRow.base_sku)) && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Open send-in batches</div>
                    {(batches ?? []).filter((b: any) => b.status === "pending" && (b.lines ?? []).some((l: any) => l.base_sku === drawerRow.base_sku))
                      .map((b: any) => (
                        <div key={b.id} className="text-xs">
                          {new Date(b.created_at).toLocaleDateString()} — ×{(b.lines ?? []).find((l: any) => l.base_sku === drawerRow.base_sku)?.qty} ({b.status})
                        </div>
                      ))}
                  </div>
                )}

                {queueError && (
                  <div className="text-xs text-destructive">couldn't load reprice queue</div>
                )}
                {(queueRows ?? []).length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Reprice queue</div>
                    {(queueRows ?? []).map((q: any, i: number) => (
                      <div key={i} className="text-xs">
                        {gbp(q.price)} — {q.status} · {q.source ?? "manual"} · {new Date(q.queued_at).toLocaleDateString()}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  <Button size="sm" variant="outline" onClick={() => deferMutation.mutate({ skus: [drawerRow.base_sku], kind: "snooze", weeks: 4 })}>
                    <Clock className="h-3.5 w-3.5 mr-1" />Snooze 4w
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => deferMutation.mutate({ skus: [drawerRow.base_sku], kind: "not_now" })}>Not now</Button>
                  <Button size="sm" variant="outline" onClick={() => delayRaiseMutation.mutate([drawerRow.base_sku])}>
                    <TrendingUp className="h-3.5 w-3.5 mr-1" />Delay &amp; raise
                  </Button>
                  <Button size="sm" variant="destructive"
                    onClick={() => { setDeferReason(drawerRow.is_hazmat ? "dangerous_goods" : "other"); setDeferDialog({ skus: [drawerRow.base_sku], hazmat: !!drawerRow.is_hazmat }); }}>
                    <PackageX className="h-3.5 w-3.5 mr-1" />Never
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

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
