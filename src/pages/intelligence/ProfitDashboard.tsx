import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLoader } from "@/components/ui/PageLoader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, ChevronLeft, ChevronRight, AlertTriangle, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, LineChart as LineChartIcon, CheckCircle2, Clock } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import OrderLineDetailSheet, { type SelectedLine } from "@/components/intelligence/OrderLineDetailSheet";

// ISO 8601 week helpers — Mon start, week 1 = first Thursday
function isoWeekOf(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function shiftIsoWeek(year: number, week: number, delta: number): { year: number; week: number } {
  // approximate by jumping 7*delta days from the Monday of the given week
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Mon);
  target.setUTCDate(target.getUTCDate() + (week - 1 + delta) * 7);
  return isoWeekOf(target);
}

const fmtGBP = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));
const fmtPct = (n: number | null | undefined) =>
  n == null ? "—" : `${(Number(n) * 100).toFixed(1)}%`;
const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB").format(Number(n));

// Per-line band classifier — mirrors get_profit_week_breakdown SQL.
// Uses POR% on VAT-inclusive order_value (profit / (order_value * 1.2) * 100)
// Defaults match app_settings.profit.loss_bands.
type ProfitBand = "clearance" | "unknown" | "loss" | "breakeven" | "poor" | "average" | "good" | "great" | "amazing" | "stellar";
const DEFAULT_THRESHOLDS = {
  loss_max: -1.0,
  breakeven_max: 1.0,
  poor_max: 9.99,
  average_max: 19.99,
  good_max: 24.99,
  great_max: 29.99,
  amazing_max: 49.99,
};
function classifyBand(
  profit: number | null | undefined,
  orderValue: number | null | undefined,
  costEach: number | null | undefined,
  t = DEFAULT_THRESHOLDS,
): ProfitBand | null {
  // No cost data → we cannot trust profit. Flag as UNKNOWN.
  if (costEach == null || Number(costEach) === 0) return "unknown";
  if (profit == null || orderValue == null || Number(orderValue) <= 0) return null;
  const por = (Number(profit) / (Number(orderValue) * 1.2)) * 100;
  if (por < t.loss_max) return "loss";
  if (por <= t.breakeven_max) return "breakeven";
  if (por <= t.poor_max) return "poor";
  if (por <= t.average_max) return "average";
  if (por <= t.good_max) return "good";
  if (por <= t.great_max) return "great";
  if (por <= t.amazing_max) return "amazing";
  return "stellar";
}
// Hazard-tape style for unknown: diagonal yellow/black stripes via inline gradient (semantic warning + foreground tokens)
const HAZARD_STRIPES =
  "[background-image:repeating-linear-gradient(45deg,hsl(var(--warning))_0_10px,hsl(var(--background))_10px_20px)]";
const BAND_BADGE: Record<ProfitBand, { label: string; className: string }> = {
  clearance: { label: "clearance", className: "border-foreground/30 bg-muted/60 text-foreground/80 font-medium" },
  unknown:   { label: "⚠ unknown", className: "border-warning/80 bg-warning/20 text-warning font-semibold" },
  loss:      { label: "loss",      className: "border-band-loss/70 bg-band-loss/15 text-band-loss" },
  breakeven: { label: "breakeven", className: "border-band-breakeven/70 bg-band-breakeven/15 text-band-breakeven" },
  poor:      { label: "poor",      className: "border-band-poor/70 bg-band-poor/15 text-band-poor" },
  average:   { label: "average",   className: "border-band-average/70 bg-band-average/15 text-band-average" },
  good:      { label: "good",      className: "border-band-good/70 bg-band-good/15 text-band-good" },
  great:     { label: "great",     className: "border-band-great/70 bg-band-great/15 text-band-great" },
  amazing:   { label: "amazing",   className: "border-band-amazing/70 bg-band-amazing/20 text-band-amazing" },
  stellar:   { label: "stellar",   className: "border-band-stellar/70 bg-band-stellar/20 text-band-stellar" },
};

const ProfitDashboard = () => {
  const today = new Date();
  const initial = isoWeekOf(today);
  const [{ year, week }, setWeek] = useState(initial);
  const [refetchKey, setRefetchKey] = useState(0);

  const weekKey = `${year}-W${String(week).padStart(2, "0")}`;

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ["profit-week", year, week, refetchKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_profit_week", {
        p_iso_year: year,
        p_iso_week: week,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as any;
    },
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ["profit-history", refetchKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profit_weekly_snapshots")
        .select("iso_year, iso_week, week_start, week_end, revenue, profit, por_pct, order_count, missing_cost_count, dirt_count")
        .order("iso_year", { ascending: false })
        .order("iso_week", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: bands, isLoading: bandsLoading } = useQuery({
    queryKey: ["profit-bands", year, week, refetchKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_profit_week_breakdown", {
        p_iso_year: year,
        p_iso_week: week,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch ALL lines for the week (paged through 1k limit), then sort/filter/page client-side
  const { data: lines, isLoading: linesLoading } = useQuery({
    queryKey: ["profit-lines-all", year, week, refetchKey],
    queryFn: async () => {
      const pageSize = 1000;
      let from = 0;
      const all: any[] = [];
      while (true) {
        const { data, error } = await (supabase as any)
          .from("order_economics_all")
          .select("mintsoft_order_id, line_index, sku, product_name, channel, qty, price, order_value, cost_each, courier_cost, channel_fee, profit, por_pct, good_dirt, missing_cost, courier, fee_rule_name, order_date")
          .eq("iso_year", year)
          .eq("iso_week", week)
          .order("mintsoft_order_id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
        if (from > 50000) break; // safety
      }
      return all;
    },
  });

  // Reprice recency per (sku, channel) — drives the "Repriced" column icon.
  // NOTE: repricing only runs on eBay (the 3D Sellers pipeline), so other channels
  // (Amazon, website) simply won't have rows here and will show "—".
  const REPRICE_WINDOW_DAYS = 30;
  const { data: repriceMap } = useQuery({
    queryKey: ["reprice-recency", REPRICE_WINDOW_DAYS],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - REPRICE_WINDOW_DAYS * 86400000).toISOString();
      const { data, error } = await (supabase as any)
        .from("threeds_reprice_pending")
        .select("sku, applied_at, last_pushed_at, threeds_stores!inner(mintsoft_channel)")
        .or(`applied_at.gte.${cutoff},last_pushed_at.gte.${cutoff}`);
      if (error) throw error;
      const m = new Map<string, { applied_at: string | null; last_pushed_at: string | null }>();
      for (const r of (data ?? []) as any[]) {
        const ch = r.threeds_stores?.mintsoft_channel;
        if (!ch) continue;
        // (store_id, sku) is unique and each store maps to one channel, so this key is unique.
        m.set(`${r.sku}|${ch}`, { applied_at: r.applied_at, last_pushed_at: r.last_pushed_at });
      }
      return m;
    },
    staleTime: 5 * 60_000,
  });

  // Active Sale / Liquidation campaigns (price_campaigns) keyed by base SKU, so
  // we can mark a line as deliberate clearance (and keep it out of the POR bands).
  const stripQ = (s: string) => (s ?? "").replace(/-Q[0-9]+$/i, "");
  const { data: clearanceMap } = useQuery({
    queryKey: ["active-clearance-campaigns"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("price_campaigns")
        .select("sku, type, start_date, end_date")
        .eq("status", "active")
        .in("type", ["sale", "liquidation"]);
      if (error) throw error;
      const m = new Map<string, { type: string; start: string; end: string | null }>();
      for (const r of (data ?? []) as any[]) m.set(stripQ(r.sku), { type: r.type, start: r.start_date, end: r.end_date });
      return m;
    },
    staleTime: 5 * 60_000,
  });

  // 'sale' | 'liquidation' | null — the line's SKU was on an active campaign of
  // that type AND the order fell within the campaign window.
  const clearanceOf = (sku: string | null, orderDate: string | null): "sale" | "liquidation" | null => {
    if (!clearanceMap || !sku) return null;
    const c = clearanceMap.get(stripQ(sku));
    if (!c) return null;
    const d = orderDate ? orderDate.slice(0, 10) : null;
    if (d && (d < c.start || (c.end && d > c.end))) return null;
    return c.type as "sale" | "liquidation";
  };

  // verified (applied & confirmed live) → green; pushed (sent, awaiting verify) → amber; else null.
  const repriceStatus = (sku: string, channel: string | null) => {
    if (!repriceMap || !channel) return null;
    const rec = repriceMap.get(`${sku}|${channel}`);
    if (!rec) return null;
    const cutoffMs = Date.now() - REPRICE_WINDOW_DAYS * 86400000;
    const a = rec.applied_at ? new Date(rec.applied_at).getTime() : 0;
    const p = rec.last_pushed_at ? new Date(rec.last_pushed_at).getTime() : 0;
    if (a >= cutoffMs) return { kind: "verified" as const, at: a };
    if (p >= cutoffMs) return { kind: "pushed" as const, at: p };
    return null;
  };

  // Filters + sorting + pagination state
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [flagFilter, setFlagFilter] = useState<string>("all"); // all | loss | dirt | missing_cost | profitable
  const [bandFilter, setBandFilter] = useState<string>("all"); // all | loss | breakeven | poor | average | good | great | amazing
  const [sortKey, setSortKey] = useState<string>("mintsoft_order_id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [selectedLine, setSelectedLine] = useState<SelectedLine | null>(null);

  const channelOptions = useMemo(() => {
    const set = new Set<string>();
    (lines ?? []).forEach((l: any) => { if (l.channel) set.add(l.channel); });
    return Array.from(set).sort();
  }, [lines]);

  // Recognition view: every sale counts toward revenue/orders/profit, including
  // deliberate loss-makers (clearance) and dirt — nothing is excluded here.
  const recognition = useMemo(() => {
    const rows = (lines ?? []) as any[];
    let lossLines = 0, lossTotal = 0, lossRevenue = 0;
    const lossOrders = new Set<number>();
    for (const r of rows) {
      const p = Number(r.profit ?? 0);
      if (p < 0) { lossLines++; lossTotal += p; lossRevenue += Number(r.order_value ?? 0); if (r.mintsoft_order_id != null) lossOrders.add(r.mintsoft_order_id); }
    }
    return { lossLines, lossTotal, lossRevenue, lossOrders: lossOrders.size };
  }, [lines]);

  // Per-channel comparison for the week (always all channels, ignores the filter)
  const byChannel = useMemo(() => {
    const m = new Map<string, { rev: number; profit: number; units: number; fee: number; courier: number; lines: number }>();
    (lines ?? []).forEach((l: any) => {
      const ch = l.channel || "—";
      const e = m.get(ch) ?? { rev: 0, profit: 0, units: 0, fee: 0, courier: 0, lines: 0 };
      e.rev += Number(l.order_value) || 0;
      e.profit += Number(l.profit) || 0;
      e.units += Number(l.qty) || 0;
      e.fee += Number(l.channel_fee) || 0;
      e.courier += Number(l.courier_cost) || 0;
      e.lines += 1;
      m.set(ch, e);
    });
    return Array.from(m.entries())
      .map(([channel, v]) => ({
        channel, ...v,
        por: v.rev > 0 ? (v.profit / (v.rev * 1.2)) * 100 : null,
        feeLoad: v.rev > 0 ? ((v.fee + v.courier) / v.rev) * 100 : null,
      }))
      .sort((a, b) => b.rev - a.rev);
  }, [lines]);

  const filteredLines = useMemo(() => {
    let rows = (lines ?? []) as any[];
    if (channelFilter !== "all") rows = rows.filter(r => (r.channel ?? "") === channelFilter);
    if (flagFilter === "loss") rows = rows.filter(r => Number(r.profit ?? 0) < 0);
    else if (flagFilter === "profitable") rows = rows.filter(r => Number(r.profit ?? 0) >= 0);
    else if (flagFilter === "dirt") rows = rows.filter(r => r.good_dirt === "Dirt");
    else if (flagFilter === "missing_cost") rows = rows.filter(r => r.missing_cost === true);
    if (bandFilter !== "all") rows = rows.filter(r => (clearanceOf(r.sku, r.order_date) ? "clearance" : classifyBand(r.profit, r.order_value, r.cost_each)) === bandFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        String(r.mintsoft_order_id ?? "").toLowerCase().includes(q) ||
        String(r.sku ?? "").toLowerCase().includes(q) ||
        String(r.product_name ?? "").toLowerCase().includes(q) ||
        String(r.channel ?? "").toLowerCase().includes(q)
      );
    }
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      const as = String(av).toLowerCase(); const bs = String(bv).toLowerCase();
      if (as < bs) return sortDir === "asc" ? -1 : 1;
      if (as > bs) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [lines, channelFilter, flagFilter, bandFilter, search, sortKey, sortDir]);

  const totalRows = filteredLines.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedLines = filteredLines.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  };


  const isThisWeek = useMemo(() => year === initial.year && week === initial.week, [year, week, initial]);

  const handleBackfill = async () => {
    toast({ title: "Backfill started", description: "Fetching the most recent 4 weeks of order economics from Mintsoft." });
    const { data, error } = await supabase.functions.invoke("backfill-order-economics", {
      body: { weeks: 4 },
    });
    if (error) {
      toast({ title: "Backfill failed", description: String(error.message ?? error), variant: "destructive" });
      return;
    }
    toast({ title: "Backfill chunk done", description: `Updated ${data?.updated ?? 0} order lines.` });
    setRefetchKey((k) => k + 1);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <ModuleHeader
          title="Profit Intelligence"
          description="Weekly revenue, costs, channel fees, courier spend and POR — calculated from live order lines."
          icon={TrendingUp}
        />
        <div className="flex-shrink-0 pt-1 flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/intelligence/profit/graphs">
              <LineChartIcon className="h-4 w-4 mr-2" />
              Graphs
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={handleBackfill}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Backfill 4 weeks
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/profit-rules">Edit rules</Link>
          </Button>
        </div>
      </div>

      {/* Week navigator */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setWeek(shiftIsoWeek(year, week, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm">
              <span className="font-semibold text-foreground">{weekKey}</span>
              {kpis?.week_start && (
                <span className="text-foreground/60 ml-2">
                  {new Date(kpis.week_start).toLocaleDateString("en-GB")} – {new Date(kpis.week_end).toLocaleDateString("en-GB")}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setWeek(shiftIsoWeek(year, week, 1))}
              disabled={isThisWeek}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {isThisWeek && <Badge variant="outline" className="ml-2">Current week</Badge>}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setWeek(initial)} disabled={isThisWeek}>
            Jump to this week
          </Button>
        </CardContent>
      </Card>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Revenue (ex VAT)" value={fmtGBP(kpis?.revenue)} loading={kpisLoading} />
        <KpiCard label="Profit" value={fmtGBP(kpis?.profit)} loading={kpisLoading}
          accent={kpis?.profit != null && Number(kpis.profit) < 0 ? "destructive" : "good"} />
        <KpiCard label="POR (profit / GMV inc VAT)" value={fmtPct(kpis?.por_pct)} loading={kpisLoading} />
        <KpiCard label="Orders" value={fmtNum(kpis?.order_count)} loading={kpisLoading} />
        <KpiCard label="Cost of goods" value={fmtGBP(kpis?.cost_total)} loading={kpisLoading} />
        <KpiCard label="Courier spend" value={fmtGBP(kpis?.courier_cost_total)} loading={kpisLoading} />
        <KpiCard label="Channel fees" value={fmtGBP(kpis?.channel_fees_total)} loading={kpisLoading} />
        <KpiCard label="AOV" value={fmtGBP(kpis?.aov)} loading={kpisLoading} />
      </div>

      <p className="text-xs text-foreground/50 -mt-2">
        Counts exclude cancelled, refunded and returned orders — only active &amp; despatched orders feed profit calculations. Mintsoft's raw weekly count will be higher.
      </p>

      {/* Per-channel comparison — click a channel to filter the table below */}
      {byChannel.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By channel</CardTitle>
            <CardDescription>Revenue, net profit, POR and fee load per channel this week. Click a channel to filter the lines below.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {byChannel.map((c) => {
                const active = channelFilter === c.channel;
                return (
                  <button
                    key={c.channel}
                    onClick={() => setChannelFilter(active ? "all" : c.channel)}
                    className={`text-left rounded-lg border p-3 transition ${active ? "border-primary ring-1 ring-primary bg-primary/5" : "hover:bg-muted/50"}`}
                  >
                    <div className="text-xs font-medium truncate" title={c.channel}>{c.channel}</div>
                    <div className="text-lg font-bold">{fmtGBP(c.rev)}</div>
                    <div className={`text-sm ${c.profit < 0 ? "text-destructive" : "text-success"}`}>{fmtGBP(c.profit)} net</div>
                    <div className="text-xs text-muted-foreground">
                      {c.por != null ? c.por.toFixed(1) : "—"}% POR · {c.feeLoad != null ? c.feeLoad.toFixed(0) : "—"}% fees · {fmtNum(c.units)}u
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All sales recognised — including deliberate loss-makers (clearance) */}
      <Card className="border-pd-accent/20 bg-pd-accent/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="text-pd-accent">£</span> All sales recognised — including losses
          </CardTitle>
          <CardDescription>
            The figures above already include every despatched sale — loss-making and clearance orders are counted, not excluded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Gross sales (inc VAT)</div>
              <div className="text-lg font-bold">{fmtGBP(kpis?.revenue != null ? Number(kpis.revenue) * 1.2 : undefined)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Net profit (all-in)</div>
              <div className={`text-lg font-bold ${kpis?.profit != null && Number(kpis.profit) < 0 ? "text-destructive" : "text-success"}`}>{fmtGBP(kpis?.profit)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Loss-making lines</div>
              <div className="text-lg font-bold text-destructive">{fmtNum(recognition.lossLines)}</div>
              <div className="text-xs text-muted-foreground">{recognition.lossOrders} order(s)</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Loss absorbed</div>
              <div className="text-lg font-bold text-destructive">{fmtGBP(recognition.lossTotal)}</div>
              <div className="text-xs text-muted-foreground">on {fmtGBP(recognition.lossRevenue)} revenue</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            "Loss absorbed" is the combined negative profit on loss-making lines this week — your true cost of clearing stock / selling below cost. Revenue and orders from these are fully counted above.
          </p>
        </CardContent>
      </Card>

      {/* Health flags */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FlagCard label="Good lines" value={fmtNum(kpis?.good_count)} accent="good" loading={kpisLoading} />
        <FlagCard
          label="Dirt SKU lines"
          value={fmtNum(kpis?.dirt_count)}
          accent={Number(kpis?.dirt_count ?? 0) > 0 ? "warning" : "good"}
          loading={kpisLoading}
          link="/intelligence/dirt-skus"
        />
        <FlagCard
          label="Missing cost lines"
          value={fmtNum(kpis?.missing_cost_count)}
          accent={Number(kpis?.missing_cost_count ?? 0) > 0 ? "destructive" : "good"}
          loading={kpisLoading}
          link="/intelligence/missing-costs"
        />
      </div>

      {/* Loss / Profit segmentation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
            <span>Profitability segmentation (per line, by POR %)</span>
            {bandFilter !== "all" && (
              <Button variant="ghost" size="sm" onClick={() => { setBandFilter("all"); setPage(1); }}>
                Clear band filter ({bandFilter})
              </Button>
            )}
          </CardTitle>
          <CardDescription>
            Order lines bucketed by their POR % (profit ÷ GMV inc VAT). Click a card to filter the table below. Thresholds editable in <Link to="/admin/profit-rules" className="underline text-pd-accent">Profit Rules</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bandsLoading ? (
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
              {[...Array(9)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : (
            <div className="space-y-2">
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
             {(["unknown","loss","breakeven","poor","average","good","great","amazing","stellar"] as const).map((b) => {
                // The breakdown is the single source for every bucket (clearance,
                // unknown, loss..stellar), so the denominator is just their sum.
                const denominator = (bands ?? []).reduce((s: number, x: any) => s + Number(x.line_count ?? 0), 0);
                const row = (bands ?? []).find((x: any) => x.band === b);
                const lineCount = Number(row?.line_count ?? 0);
                const profitTotal: number | null = b === "unknown" ? null : (row?.profit_total ?? 0);
                const pctOfLines = denominator > 0 ? (lineCount / denominator) * 100 : 0;
                const meta: Record<string, { label: string; tone: string }> = {
                  unknown:   { label: "Unknown",   tone: `border-warning/70 ${HAZARD_STRIPES}` },
                  loss:      { label: "Loss",      tone: "border-band-loss/60 bg-band-loss/15" },
                  breakeven: { label: "Breakeven", tone: "border-band-breakeven/60 bg-band-breakeven/15" },
                  poor:      { label: "Poor",      tone: "border-band-poor/60 bg-band-poor/15" },
                  average:   { label: "Average",   tone: "border-band-average/60 bg-band-average/15" },
                  good:      { label: "Good",      tone: "border-band-good/60 bg-band-good/15" },
                  great:     { label: "Great",     tone: "border-band-great/60 bg-band-great/15" },
                  amazing:   { label: "Amazing",   tone: "border-band-amazing/60 bg-band-amazing/15" },
                  stellar:   { label: "Stellar",   tone: "border-band-stellar/70 bg-band-stellar/20" },
                };
                const m = meta[b];
                const isActive = bandFilter === b;
                const isUnknown = b === "unknown";
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => { setBandFilter(isActive ? "all" : b); setPage(1); }}
                    className={`text-left rounded-md border-2 p-2 transition hover:brightness-125 focus:outline-none focus:ring-2 focus:ring-pd-accent ${m.tone} ${isActive ? "ring-2 ring-pd-accent" : ""}`}
                  >
                    <div className={`text-xs uppercase tracking-wide ${isUnknown ? "text-warning font-bold bg-background/80 px-1 rounded inline-block" : "text-foreground/60"}`}>
                      {isUnknown ? "⚠ " : ""}{m.label}
                    </div>
                    <div className={`text-lg font-bold mt-0.5 ${isUnknown ? "text-foreground bg-background/80 px-1 rounded inline-block" : "text-foreground"}`}>{fmtNum(lineCount)}</div>
                    <div className={`text-xs mt-0.5 ${isUnknown ? "text-foreground bg-background/80 px-1 rounded inline-block" : "text-foreground/70"}`}>{pctOfLines.toFixed(1)}% of lines</div>
                    <div className={`text-xs font-mono mt-1 ${isUnknown ? "text-foreground bg-background/80 px-1 rounded inline-block" : "text-foreground/80"}`}>
                      {isUnknown ? "no cost data" : fmtGBP(profitTotal ?? 0)}
                    </div>
                  </button>
                );
              })}
            </div>
            {(() => {
              const denominator = (bands ?? []).reduce((s: number, x: any) => s + Number(x.line_count ?? 0), 0);
              const row = (bands ?? []).find((x: any) => x.band === "clearance");
              const lineCount = Number(row?.line_count ?? 0);
              const profitTotal = Number(row?.profit_total ?? 0);
              const pctOfLines = denominator > 0 ? (lineCount / denominator) * 100 : 0;
              let saleN = 0, liqN = 0;
              for (const r of (lines ?? []) as any[]) { const c = clearanceOf(r.sku, r.order_date); if (c === "sale") saleN++; else if (c === "liquidation") liqN++; }
              const isActive = bandFilter === "clearance";
              return (
                <button type="button"
                  onClick={() => { setBandFilter(isActive ? "all" : "clearance"); setPage(1); }}
                  className={`w-full text-left rounded-md border-2 border-foreground/25 bg-muted/50 p-2 transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-pd-accent ${isActive ? "ring-2 ring-pd-accent" : ""}`}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-xs uppercase tracking-wide text-foreground/70 font-medium">Clearance</span>
                    <span className="text-lg font-bold text-foreground">{fmtNum(lineCount)}</span>
                    <span className="text-xs text-foreground/70">{pctOfLines.toFixed(1)}% of lines</span>
                    <span className="text-xs font-mono text-foreground/80">{fmtGBP(profitTotal)}</span>
                    <span className="text-xs text-foreground/60">{fmtNum(saleN)} on sale · {fmtNum(liqN)} liquidating</span>
                    <span className="text-xs text-foreground/45 ml-auto">deliberate clearance — excluded from the bands above</span>
                  </div>
                </button>
              );
            })()}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order lines — {weekKey}</CardTitle>
          <CardDescription>
            All order lines for this week. Click any column header to sort. Use the filters to narrow down.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search order ID, SKU, product, channel…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="max-w-xs"
            />
            <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Channel" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                {channelOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={flagFilter} onValueChange={(v) => { setFlagFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Flag" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All lines</SelectItem>
                <SelectItem value="loss">Loss only</SelectItem>
                <SelectItem value="profitable">Profitable only</SelectItem>
                <SelectItem value="dirt">Dirt SKUs</SelectItem>
                <SelectItem value="missing_cost">Missing cost</SelectItem>
              </SelectContent>
            </Select>
            <Select value={bandFilter} onValueChange={(v) => { setBandFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Profit segment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All segments</SelectItem>
                {(["clearance","unknown","loss","breakeven","poor","average","good","great","amazing","stellar"] as const).map((b) => (
                  <SelectItem key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[25, 50, 100, 200, 500].map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="text-xs text-foreground/60 ml-auto">
              {fmtNum(totalRows)} lines • Page {safePage} of {totalPages}
            </div>
          </div>

          {linesLoading ? (
            <PageLoader rows={8} columns={[100, 130, 90, 60, 60, 70, 70, 70, 70, 80, 60, 80]} label="Loading order lines" />
          ) : totalRows === 0 ? (
            <div className="text-sm text-foreground/60 py-6 text-center">
              No order lines match the current filters.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead label="Order" col="mintsoft_order_id" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <SortableHead label="SKU" col="sku" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <SortableHead label="Channel" col="channel" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <TableHead className="text-center" title="Sale/Liq = on an active clearance campaign. Otherwise reprice recency (eBay only): green = confirmed live, amber = pushed (awaiting verify).">Status</TableHead>
                      <SortableHead label="Qty" col="qty" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <SortableHead label="Price" col="price" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <SortableHead label="Cost" col="cost_each" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <SortableHead label="Courier" col="courier_cost" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <SortableHead label="Fee" col="channel_fee" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <SortableHead label="Profit" col="profit" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <SortableHead label="POR" col="por_pct" align="right" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                      <TableHead>Flags</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedLines.map((l: any, i: number) => (
                      <TableRow
                        key={`${l.mintsoft_order_id}-${l.line_index}-${i}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedLine({
                          mintsoft_order_id: l.mintsoft_order_id,
                          line_index: l.line_index,
                          sku: l.sku,
                          channel: l.channel,
                        })}
                      >
                        <TableCell className="font-mono text-xs text-pd-accent underline-offset-2 hover:underline">{l.mintsoft_order_id}</TableCell>
                        <TableCell className="font-medium">{l.sku}</TableCell>
                        <TableCell className="text-xs text-foreground/70">{l.channel ?? "—"}</TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const clr = clearanceOf(l.sku, l.order_date);
                            if (clr) return (
                              <Badge variant="outline" className="text-[10px] border-foreground/30 bg-muted/60 text-foreground/80"
                                title={clr === "sale" ? "On an active Sale campaign" : "On an active Liquidation campaign"}>
                                {clr === "sale" ? "Sale" : "Liq"}
                              </Badge>
                            );
                            const st = repriceStatus(l.sku, l.channel);
                            if (!st) return <span className="text-foreground/30">—</span>;
                            const days = Math.max(0, Math.floor((Date.now() - st.at) / 86400000));
                            const ago = days === 0 ? "today" : `${days}d ago`;
                            return st.kind === "verified" ? (
                              <span title={`Repriced ${ago} — confirmed live`}>
                                <CheckCircle2 className="h-4 w-4 inline text-emerald-600" />
                              </span>
                            ) : (
                              <span title={`Price pushed ${ago} — awaiting verification`}>
                                <Clock className="h-4 w-4 inline text-amber-500" />
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-right">{l.qty}</TableCell>
                        <TableCell className="text-right">{fmtGBP(l.price)}</TableCell>
                        <TableCell className="text-right">{fmtGBP(l.cost_each)}</TableCell>
                        <TableCell className="text-right">{fmtGBP(l.courier_cost)}</TableCell>
                        <TableCell className="text-right">{fmtGBP(l.channel_fee)}</TableCell>
                        <TableCell className={`text-right font-semibold ${Number(l.profit) < 0 ? "text-destructive" : "text-foreground"}`}>
                          {fmtGBP(l.profit)}
                        </TableCell>
                        <TableCell className="text-right">{fmtPct(l.por_pct)}</TableCell>
                        <TableCell className="space-x-1 whitespace-nowrap">
                          {(() => {
                            const band = clearanceOf(l.sku, l.order_date) ? ("clearance" as const) : classifyBand(l.profit, l.order_value, l.cost_each);
                            if (band) {
                              const b = BAND_BADGE[band];
                              return <Badge variant="outline" className={`text-[10px] ${b.className}`}>{b.label}</Badge>;
                            }
                            return null;
                          })()}
                          {/* missing-cost lines are surfaced via the ⚠ unknown band badge above */}
                          {l.good_dirt === "Dirt" && <Badge variant="outline" className="text-[10px] border-warning text-warning">dirt</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
                <div className="text-xs text-foreground/60">
                  Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, totalRows)} of {fmtNum(totalRows)}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => setPage(1)} disabled={safePage === 1}>« First</Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </Button>
                  <span className="text-xs px-2">Page {safePage} / {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>Last »</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>


      {/* Snapshot history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly history (snapshots)</CardTitle>
          <CardDescription>From <code>profit_weekly_snapshots</code>. Backfill weeks 1–17 from XLSX is pending.</CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (history?.length ?? 0) === 0 ? (
            <div className="flex items-center gap-2 text-sm text-foreground/60 py-6">
              <AlertTriangle className="h-4 w-4 text-warning" />
              No weekly snapshots yet. They'll be created by the weekly cron or by ingesting historical XLSX data.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week</TableHead>
                    <TableHead>Range</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">POR</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Missing cost</TableHead>
                    <TableHead className="text-right">Dirt</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history!.map((row: any) => (
                    <TableRow key={`${row.iso_year}-${row.iso_week}`}>
                      <TableCell className="font-mono text-xs">{row.iso_year}-W{String(row.iso_week).padStart(2, "0")}</TableCell>
                      <TableCell className="text-xs text-foreground/70">
                        {new Date(row.week_start).toLocaleDateString("en-GB")} – {new Date(row.week_end).toLocaleDateString("en-GB")}
                      </TableCell>
                      <TableCell className="text-right">{fmtGBP(row.revenue)}</TableCell>
                      <TableCell className={`text-right ${Number(row.profit) < 0 ? "text-destructive" : ""}`}>{fmtGBP(row.profit)}</TableCell>
                      <TableCell className="text-right">{fmtPct(row.por_pct)}</TableCell>
                      <TableCell className="text-right">{fmtNum(row.order_count)}</TableCell>
                      <TableCell className="text-right">{fmtNum(row.missing_cost_count)}</TableCell>
                      <TableCell className="text-right">{fmtNum(row.dirt_count)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setWeek({ year: row.iso_year, week: row.iso_week })}>
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <OrderLineDetailSheet
        line={selectedLine}
        open={selectedLine !== null}
        onOpenChange={(o) => { if (!o) setSelectedLine(null); }}
      />
    </div>
  );
};

const KpiCard = ({ label, value, loading, accent }: { label: string; value: string; loading?: boolean; accent?: "good" | "destructive" }) => (
  <Card>
    <CardContent className="p-4">
      <div className="text-xs uppercase tracking-wide text-foreground/60">{label}</div>
      {loading ? (
        <Skeleton className="h-7 w-24 mt-2" />
      ) : (
        <div className={`text-2xl font-bold mt-1 ${accent === "destructive" ? "text-destructive" : accent === "good" ? "text-pd-accent" : "text-foreground"}`}>
          {value}
        </div>
      )}
    </CardContent>
  </Card>
);

const FlagCard = ({ label, value, accent, loading, link }: { label: string; value: string; accent: "good" | "warning" | "destructive"; loading?: boolean; link?: string }) => {
  const color = accent === "destructive" ? "text-destructive" : accent === "warning" ? "text-warning" : "text-pd-accent";
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-foreground/60">{label}</div>
          {loading ? <Skeleton className="h-7 w-16 mt-2" /> : <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>}
        </div>
        {link && (
          <Button asChild variant="outline" size="sm">
            <Link to={link}>Review</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

const SortableHead = ({ label, col, align, sortKey, sortDir, onClick }: {
  label: string; col: string; align?: "right"; sortKey: string; sortDir: "asc" | "desc"; onClick: (col: string) => void;
}) => {
  const active = sortKey === col;
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onClick(col)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground" : "text-foreground/70"} ${align === "right" ? "ml-auto" : ""}`}
      >
        <span>{label}</span>
        <Icon className="h-3 w-3" />
      </button>
    </TableHead>
  );
};

export default ProfitDashboard;
