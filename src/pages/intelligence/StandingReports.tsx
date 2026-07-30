import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ModuleHeader from "@/components/ModuleHeader";
import Profit8020Report from "@/pages/intelligence/Profit8020Report";
import ClearanceReport from "@/pages/intelligence/ClearanceReport";
import { FileBarChart2, TrendingUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { PageLoader } from "@/components/ui/PageLoader";

const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

interface Acc { actual_units: number; actual_profit: number; cf_units: number; cf_profit: number; value: number; }
interface Payoff {
  ok: boolean; empty?: boolean; generated_at: string; repriced_skus: number; earliest_reprice: string;
  total: Acc;
  by_account: ({ account: string } & Acc)[];
  assumptions: { courier_per_unit: number; vat: number; baseline_days: number; go_live: string; note: string };
}

function RepricingPayoff() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["reprice-payoff"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("reprice-payoff", { body: {} });
      if (error) throw error;
      return data as Payoff;
    },
  });

  const { data: trend } = useQuery({
    queryKey: ["reprice-payoff-trend"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reprice_payoff_daily" as any)
        .select("snapshot_date, value, actual_profit, cf_profit").order("snapshot_date", { ascending: true }).limit(180);
      if (error) return [] as any[];
      return (data ?? []) as unknown as { snapshot_date: string; value: number; actual_profit: number; cf_profit: number }[];
    },
  });

  // Per-day value = day-over-day change in the cumulative value.
  const dailyTrend = useMemo(() => {
    const tr = trend ?? [];
    return tr.map((p, i) => ({ snapshot_date: p.snapshot_date, daily: Math.round((i === 0 ? p.value : p.value - tr[i - 1].value) * 100) / 100 }));
  }, [trend]);

  if (isLoading) return <PageLoader rows={6} columns={[160, 90, 90, 90, 90, 80]} label="Loading payoff" />;
  if (isError || !data?.ok) return <div className="py-10 text-center text-sm text-muted-foreground">Couldn't load the payoff report.</div>;
  if (data.empty) return <div className="py-10 text-center text-sm text-muted-foreground">No repriced items yet.</div>;

  const t = data.total;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {data.repriced_skus} repriced SKUs · since {new Date(data.earliest_reprice).toLocaleDateString("en-GB")} ·
          updated {new Date(data.generated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Headline cards */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Value created</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-pd-accent">{gbp(t.value)}</div>
            <div className="text-xs text-muted-foreground">profit now vs no repricer (same period)</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Since prices went live</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold ${t.actual_profit < 0 ? "text-destructive" : ""}`}>{gbp(t.actual_profit)}</div>
            <div className="text-xs text-muted-foreground">on {t.actual_units} units actually sold</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Loss avoided</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive">{gbp(t.cf_profit)}</div>
            <div className="text-xs text-muted-foreground">usual {Math.round(t.cf_units)} units would've run at old prices</div></CardContent>
        </Card>
      </div>

      {/* Trend */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-pd-accent" /> Value created over time</CardTitle></CardHeader>
        <CardContent>
          {!trend || trend.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">Trend builds from tonight's first daily snapshot. (Each night logs the day's figure so you can watch it settle.)</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--pd-accent))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--pd-accent))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="snapshot_date" tickFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} fontSize={11} />
                <YAxis tickFormatter={(v) => `£${v}`} fontSize={11} width={48} />
                <Tooltip formatter={(v: number) => gbp(v)} labelFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { dateStyle: "medium" })} />
                <Area type="monotone" dataKey="value" name="Value created" stroke="hsl(var(--pd-accent))" fill="url(#vg)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-day value created */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-pd-accent" /> Value created per day</CardTitle></CardHeader>
        <CardContent>
          {dailyTrend.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">Daily bars appear once there are two or more days of history.</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dailyTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="snapshot_date" tickFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} fontSize={11} />
                <YAxis tickFormatter={(v) => `£${v}`} fontSize={11} width={48} />
                <Tooltip formatter={(v: number) => gbp(v)} labelFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { dateStyle: "medium" })} />
                <Bar dataKey="daily" name="That day">
                  {dailyTrend.map((d, i) => <Cell key={i} fill={d.daily < 0 ? "hsl(var(--destructive))" : "hsl(var(--pd-accent))"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* By account (congruent with the headline) */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-pd-accent" /> By account</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Sold (u)</TableHead><TableHead className="text-right">Profit now</TableHead>
              <TableHead className="text-right">Usual (u)</TableHead><TableHead className="text-right">Would've made</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.by_account.map((a) => (
                <TableRow key={a.account}>
                  <TableCell>{a.account}</TableCell>
                  <TableCell className="text-right">{a.actual_units}</TableCell>
                  <TableCell className={`text-right ${a.actual_profit < 0 ? "text-destructive" : ""}`}>{gbp(a.actual_profit)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{Math.round(a.cf_units)}</TableCell>
                  <TableCell className={`text-right ${a.cf_profit < 0 ? "text-destructive" : ""}`}>{gbp(a.cf_profit)}</TableCell>
                  <TableCell className="text-right font-medium text-pd-accent">{gbp(a.value)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t-2">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{t.actual_units}</TableCell>
                <TableCell className={`text-right ${t.actual_profit < 0 ? "text-destructive" : ""}`}>{gbp(t.actual_profit)}</TableCell>
                <TableCell className="text-right">{Math.round(t.cf_units)}</TableCell>
                <TableCell className={`text-right ${t.cf_profit < 0 ? "text-destructive" : ""}`}>{gbp(t.cf_profit)}</TableCell>
                <TableCell className="text-right text-pd-accent">{gbp(t.value)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        <strong>Value created</strong> = profit on the sales we actually made since each item's price went live, minus what those products
        would have done at their old prices over the same period — using each item's <em>usual</em> pre-reprice sales rate (so an item that
        sold at a loss and now sells less still counts the avoided loss). Real eBay fee + buyer postage per sale; courier est. {gbp(data.assumptions.courier_per_unit)}/unit.
        ⚠️ Early days: a few days of actual sales vs a {data.assumptions.baseline_days}-day rate is noisy and tends to <em>overstate</em> — it
        firms up over a week or two. Direction is reliable; the precise £ isn't yet.
      </p>
    </div>
  );
}

function Placeholder({ name }: { name: string }) {
  return <div className="py-16 text-center text-sm text-muted-foreground">{name} — coming soon.</div>;
}

const MONTH_LABEL = (d: string) => new Date(d).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    climbing:  { label: "▲ Climbing", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
    falling:   { label: "▼ Falling", cls: "bg-destructive/15 text-destructive border-destructive/30" },
    steady:    { label: "Steady", cls: "bg-muted text-foreground/60 border-border" },
    new:       { label: "★ New", cls: "bg-pd-accent/15 text-pd-accent border-pd-accent/30" },
    returning: { label: "Returning", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  };
  const m = map[status] ?? map.steady;
  return <Badge variant="outline" className={`text-[10px] ${m.cls}`}>{m.label}</Badge>;
}

function TopSellers() {
  const { data: months } = useQuery({
    queryKey: ["top-sellers-months"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_top_sellers_months");
      if (error) throw error;
      return (data ?? []) as { period_month: string; skus: number }[];
    },
  });
  const [month, setMonth] = useState<string | undefined>();
  const [view, setView] = useState<"all" | "oos" | "low">("all");
  const selMonth = month ?? months?.[0]?.period_month;

  const { data: rows, isLoading } = useQuery({
    queryKey: ["top-sellers", selMonth],
    enabled: !!selMonth,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_top_sellers_report", { p_month: selMonth });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const { data: dropped } = useQuery({
    queryKey: ["top-sellers-dropped", selMonth],
    enabled: !!selMonth,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_top_sellers_dropped", { p_month: selMonth });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const { data: conc } = useQuery({
    queryKey: ["top-sellers-conc", selMonth],
    enabled: !!selMonth,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sku_rank_month_summary").select("*").eq("period_month", selMonth).maybeSingle();
      if (error) throw error;
      return data as { top_units: number; total_units: number; top_profit: number; total_profit: number } | null;
    },
  });
  const pct = (a?: number, b?: number) => (a != null && b) ? Math.round((a / b) * 1000) / 10 : null;

  const summary = useMemo(() => {
    const r = rows ?? [];
    const grp = (field: string) => ({
      climbing: r.filter((x) => x[field] === "climbing").length,
      falling: r.filter((x) => x[field] === "falling").length,
      isNew: r.filter((x) => x[field] === "new").length,
      returning: r.filter((x) => x[field] === "returning").length,
    });
    return {
      aws: grp("status"),
      profit: grp("profit_status"),
      oos: r.filter((x) => x.stock === 0).length,
      low: r.filter((x) => x.aws > 0 && x.stock / x.aws < 2).length,
    };
  }, [rows]);

  const filtered = useMemo(() => (rows ?? []).filter((r) => {
    if (view === "oos") return r.stock === 0;
    if (view === "low") return r.aws > 0 && r.stock / r.aws < 2;
    return true;
  }), [rows, view]);

  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "rank", dir: "asc" });
  const toggleSort = (col: string) =>
    setSort((s) => s.col === col
      ? { col, dir: s.dir === "asc" ? "desc" : "asc" }
      : { col, dir: ["rank", "sku", "product", "status"].includes(col) ? "asc" : "desc" });
  const sorted = useMemo(() => {
    const key = (r: any) => {
      switch (sort.col) {
        case "sku": return r.sku ?? "";
        case "product": return r.product ?? "";
        case "aws": return r.aws ?? 0;
        case "delta": return r.rank_delta ?? -9999;
        case "stock": return r.stock ?? 0;
        case "cover": return r.aws > 0 ? r.stock / r.aws : Number.POSITIVE_INFINITY;
        case "status": return r.status ?? "";
        case "units_pct": return r.units_pct ?? 0;
        case "profit": return r.profit ?? -1e12;
        case "profit_pct": return r.profit_pct ?? -1e12;
        case "pdelta": return r.profit_delta_pct ?? -1e12;
        case "pstatus": return r.profit_status ?? "";
        default: return r.rank;
      }
    };
    return [...filtered].sort((a, b) => {
      const ka = key(a), kb = key(b);
      const c = ka < kb ? -1 : ka > kb ? 1 : 0;
      return sort.dir === "asc" ? c : -c;
    });
  }, [filtered, sort]);

  const Chips = ({ s }: { s: { climbing: number; falling: number; isNew: number; returning: number } }) => (
    <>
      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">▲ {s.climbing} climbing</Badge>
      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">▼ {s.falling} falling</Badge>
      <Badge variant="outline" className="bg-pd-accent/10 text-pd-accent border-pd-accent/30">★ {s.isNew} new</Badge>
      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">{s.returning} returning</Badge>
    </>
  );

  const SortHead = ({ col, label, align }: { col: string; label: string; align?: "right" }) => (
    <TableHead
      onClick={() => toggleSort(col)}
      className={`cursor-pointer select-none hover:text-foreground ${align === "right" ? "text-right" : ""}`}
    >
      {label}{sort.col === col ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
    </TableHead>
  );

  if (isLoading && !rows) return <PageLoader rows={10} columns={[40, 150, 200, 70, 90, 60, 60, 90]} label="Loading top sellers" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Month</span>
          <Select value={selMonth} onValueChange={setMonth}>
            <SelectTrigger className="w-[180px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(months ?? []).map((m) => (
                <SelectItem key={m.period_month} value={m.period_month}>{MONTH_LABEL(m.period_month)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={view} onValueChange={(v) => setView(v as "all" | "oos" | "low")}>
            <SelectTrigger className="w-[190px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="oos">Out of stock only ({summary.oos})</SelectItem>
              <SelectItem value="low">Coverage low &lt; 2wk ({summary.low})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-muted-foreground w-12 shrink-0">AWS</span>
            <Chips s={summary.aws} />
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-muted-foreground w-12 shrink-0">Profit</span>
            <Chips s={summary.profit} />
          </div>
        </div>
      </div>

      {conc && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Top 100 share of units</div>
              <div className="text-2xl font-bold text-pd-accent">{pct(conc.top_units, conc.total_units)}%</div>
              <div className="text-xs text-muted-foreground">{conc.top_units?.toLocaleString()} of {conc.total_units?.toLocaleString()} units sold this month</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Top 100 share of profit</div>
              <div className="text-2xl font-bold">{pct(conc.top_profit, conc.total_profit)}%</div>
              <div className="text-xs text-muted-foreground">{gbp(conc.top_profit)} of {gbp(conc.total_profit)} profit this month</div>
            </CardContent>
          </Card>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Top 100 SKUs by units for the month, all channels, on corrected economics. <strong>AWS</strong> = average weekly sales
        (units ÷ weeks elapsed). <strong>Cover</strong> = weeks of stock at that rate (red under 2 weeks). YoY lights up once we have a prior year.
        The two cards show how much of the month's total <em>units</em> and <em>profit</em> these 100 SKUs represent — units concentration is
        typically far higher than profit, since the top sellers are high-volume, low-margin lines.
      </p>

      <Card>
        <CardContent className="p-0 [&>div]:max-h-[72vh]">
          <Table>
            <TableHeader className="sticky top-0 z-20 [&_th]:bg-card [&_th]:shadow-[inset_0_-1px_0_hsl(var(--border))]">
              <TableRow>
                <SortHead col="rank" label="#" />
                <SortHead col="sku" label="SKU" />
                <SortHead col="product" label="Product" />
                <SortHead col="aws" label="AWS" align="right" />
                <SortHead col="units_pct" label="AWS %" align="right" />
                <SortHead col="delta" label="vs last mo" align="right" />
                <SortHead col="profit" label="Profit" align="right" />
                <SortHead col="profit_pct" label="Profit %" align="right" />
                <SortHead col="pdelta" label="vs last mo" align="right" />
                <SortHead col="stock" label="Stock" align="right" />
                <SortHead col="cover" label="Cover" align="right" />
                <SortHead col="status" label="AWS status" />
                <SortHead col="pstatus" label="Profit status" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 && (
                <TableRow><TableCell colSpan={13} className="text-center text-sm text-muted-foreground py-8">No SKUs match this filter for {selMonth ? MONTH_LABEL(selMonth) : "this month"}.</TableCell></TableRow>
              )}
              {sorted.map((r) => {
                const cover = r.aws > 0 ? r.stock / r.aws : null;
                const low = cover != null && cover < 2;
                return (
                  <TableRow key={r.sku}>
                    <TableCell className="text-muted-foreground">{r.rank}</TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{r.sku}</TableCell>
                    <TableCell className="text-xs text-foreground/70 max-w-[220px] truncate">{r.product}</TableCell>
                    <TableCell className="text-right font-semibold">{r.aws?.toFixed(1)}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{r.units_pct != null ? `${r.units_pct}%` : "—"}</TableCell>
                    <TableCell className="text-right text-xs whitespace-nowrap">
                      {r.rank_delta == null ? <span className="text-muted-foreground">—</span> :
                        r.rank_delta > 0 ? <span className="text-emerald-600">▲{r.rank_delta}</span> :
                        r.rank_delta < 0 ? <span className="text-destructive">▼{Math.abs(r.rank_delta)}</span> :
                        <span className="text-muted-foreground">–</span>}
                      {r.aws_pct_delta != null && <span className={`ml-1 ${r.aws_pct_delta >= 0 ? "text-emerald-600" : "text-destructive"}`}>{r.aws_pct_delta > 0 ? "+" : ""}{r.aws_pct_delta}%</span>}
                    </TableCell>
                    <TableCell className={`text-right font-semibold whitespace-nowrap ${r.profit < 0 ? "text-destructive" : ""}`}>{gbp(r.profit)}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{r.profit_pct != null ? `${r.profit_pct}%` : "—"}</TableCell>
                    <TableCell className="text-right text-xs whitespace-nowrap">
                      {r.profit_delta_pct == null ? <span className="text-muted-foreground">—</span> :
                        <span className={r.profit_delta_pct >= 0 ? "text-emerald-600" : "text-destructive"}>{r.profit_delta_pct > 0 ? "+" : ""}{r.profit_delta_pct}%</span>}
                    </TableCell>
                    <TableCell className={`text-right ${low ? "text-destructive font-semibold" : ""}`}>{r.stock}</TableCell>
                    <TableCell className={`text-right ${low ? "text-destructive font-semibold" : "text-muted-foreground"}`}>{cover == null ? "—" : `${cover.toFixed(1)}w`}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell><StatusBadge status={r.profit_status} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(dropped?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Dropped out of the top 100 (vs last month)</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>SKU</TableHead><TableHead>Product</TableHead>
                <TableHead className="text-right">Was #</TableHead><TableHead className="text-right">Now #</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(dropped ?? []).map((d) => (
                  <TableRow key={d.sku}>
                    <TableCell className="font-medium">{d.sku}</TableCell>
                    <TableCell className="text-xs text-foreground/70 max-w-[320px] truncate">{d.product}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{d.prev_rank}</TableCell>
                    <TableCell className="text-right">{d.now_rank ?? "off list"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function StandingReports() {
  return (
    <div className="space-y-6">
      <ModuleHeader title="Standing Reports" description="Recurring intelligence reports — tracked over time." icon={FileBarChart2} />
      <Tabs defaultValue="payoff" className="w-full">
        <TabsList>
          <TabsTrigger value="payoff">Repricing Payoff</TabsTrigger>
          <TabsTrigger value="b">80:20 Profit</TabsTrigger>
          <TabsTrigger value="c">Clearance</TabsTrigger>
          <TabsTrigger value="top">Top Sellers</TabsTrigger>
        </TabsList>
        <TabsContent value="payoff" className="mt-4"><RepricingPayoff /></TabsContent>
        <TabsContent value="b" className="mt-4"><Profit8020Report /></TabsContent>
        <TabsContent value="c" className="mt-4"><ClearanceReport /></TabsContent>
        <TabsContent value="top" className="mt-4"><TopSellers /></TabsContent>
      </Tabs>
    </div>
  );
}
