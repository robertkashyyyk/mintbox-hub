import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageLoader } from "@/components/ui/PageLoader";
import { useCreateTask } from "@/hooks/tasks/useTasks";
import {
  ResponsiveContainer, LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, Cell,
} from "recharts";
import {
  TrendingUp, ChevronDown, ChevronRight, ShieldCheck, Boxes, ListChecks,
  ScatterChart as ScatterIcon, Plus, ExternalLink,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------
interface Row {
  base_sku: string; product_name: string | null; brand_name: string | null;
  units: number; profit: number; profit_per_week: number; por_pct: number | null;
  on_hand: number; cost_each: number | null; avg_weekly_units: number;
  stock_cover_days: number | null;
  capital: number; targeted_capital: number | null; trapped_capital: number | null;
  overstock: boolean; capital_efficiency: number | null; weeks_in_top_tier: number;
}

const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
const gbp2 = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const num = (n: number | null | undefined, d = 0) =>
  n == null ? "—" : n.toLocaleString("en-GB", { maximumFractionDigits: d });

// POR bands mirror app_settings.profit.loss_bands (see ProfitDashboard.classifyBand).
function classifyBand(por: number | null): { label: string; cls: string } {
  if (por == null) return { label: "—", cls: "bg-muted text-muted-foreground" };
  if (por < -1) return { label: "Loss", cls: "bg-destructive/15 text-destructive" };
  if (por < 1) return { label: "Breakeven", cls: "bg-muted text-foreground" };
  if (por < 10) return { label: "Poor", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" };
  if (por < 20) return { label: "Average", cls: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" };
  if (por < 25) return { label: "Good", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" };
  if (por < 30) return { label: "Great", cls: "bg-emerald-600/20 text-emerald-700 dark:text-emerald-400" };
  return { label: "Amazing", cls: "bg-pd-accent/20 text-pd-accent" };
}

// Stock cover RAG: <7 red, 7–21 amber, >21 green.
function coverRag(days: number | null): { cls: string; label: string } {
  if (days == null) return { cls: "text-muted-foreground", label: "no velocity" };
  if (days < 7) return { cls: "text-destructive font-semibold", label: `${days}d` };
  if (days <= 21) return { cls: "text-amber-600 dark:text-amber-400", label: `${days}d` };
  return { cls: "text-emerald-600 dark:text-emerald-400", label: `${days}d` };
}

const skuLink = (sku: string) => `/discovery/products?search=${encodeURIComponent(sku)}`;

// Suggested reorder qty to reach target holding: target units (targeted_capital /
// landed cost) minus what's on hand. Mirrors the brand base-multiplier reorder logic.
function reorderQty(r: Row): number | null {
  if (!r.cost_each || r.cost_each <= 0 || r.targeted_capital == null) return null;
  const targetUnits = r.targeted_capital / r.cost_each;
  const q = Math.round(targetUnits - (r.on_hand ?? 0));
  return q > 0 ? q : null;
}

type SortKey = "profit_per_week" | "capital_efficiency" | "trapped_capital" | "weeks_in_top_tier" | "stock_cover_days" | "capital";

// ---------------------------------------------------------------------------
// Main report
// ---------------------------------------------------------------------------
export default function Profit8020Report() {
  const [weeks, setWeeks] = useState(8);
  const [brand, setBrand] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["profit-8020", weeks],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_8020_leaderboard", { p_weeks: weeks });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const brands = useMemo(() => {
    const s = new Set<string>();
    (data ?? []).forEach((r) => r.brand_name && s.add(r.brand_name));
    return Array.from(s).sort();
  }, [data]);

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (brand !== "all") rows = rows.filter((r) => r.brand_name === brand);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.base_sku.toLowerCase().includes(q) || (r.product_name ?? "").toLowerCase().includes(q));
    }
    return rows;
  }, [data, brand, search]);

  // Pareto: rank by profit desc, cumulative share.
  const pareto = useMemo(() => {
    const rows = [...filtered].filter((r) => r.profit > 0).sort((a, b) => b.profit - a.profit);
    const total = rows.reduce((s, r) => s + r.profit, 0);
    let cum = 0;
    const pts = rows.map((r, i) => {
      cum += r.profit;
      return { x: ((i + 1) / rows.length) * 100, cumPct: total > 0 ? (cum / total) * 100 : 0 };
    });
    // SKUs needed to reach 80% of profit
    let n80 = 0; let acc = 0;
    for (const r of rows) { acc += r.profit; n80++; if (total > 0 && acc / total >= 0.8) break; }
    return { pts, total, count: rows.length, n80, pct80: rows.length ? (n80 / rows.length) * 100 : 0 };
  }, [filtered]);

  const totals = useMemo(() => {
    const rows = filtered;
    return {
      profit: rows.reduce((s, r) => s + (r.profit || 0), 0),
      capital: rows.reduce((s, r) => s + (r.capital || 0), 0),
      trapped: rows.reduce((s, r) => s + (r.trapped_capital || 0), 0),
      atRisk: rows.filter((r) => r.stock_cover_days != null && r.stock_cover_days < 7).length,
    };
  }, [filtered]);

  if (isLoading) return <PageLoader rows={8} columns={[200, 80, 80, 80, 80, 80, 80]} label="Crunching 80:20" />;
  if (isError) return <div className="py-10 text-center text-sm text-muted-foreground">Couldn't load the 80:20 report.</div>;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(weeks)} onValueChange={(v) => setWeeks(Number(v))}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="4">Last 4 weeks</SelectItem>
            <SelectItem value="8">Last 8 weeks</SelectItem>
            <SelectItem value="12">Last 12 weeks</SelectItem>
          </SelectContent>
        </Select>
        <Select value={brand} onValueChange={setBrand}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All brands" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All brands</SelectItem>
            {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Search SKU / name" value={search} onChange={(e) => setSearch(e.target.value)} className="w-[200px]" />
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} costed SKUs · eBay/FBM</span>
      </div>

      {/* Filter-aware headline cards */}
      <div className="grid gap-3 md:grid-cols-4">
        <MiniCard label={`Profit (last ${weeks}w)`} value={gbp(totals.profit)} hint="costed sales only" accent />
        <MiniCard label="Capital tied up" value={gbp(totals.capital)} hint="on-hand × landed cost" />
        <MiniCard label="Trapped capital" value={gbp(totals.trapped)} hint="over target holding" warn={totals.trapped > 0} />
        <MiniCard label="Earners at risk" value={String(totals.atRisk)} hint="< 7 days cover" warn={totals.atRisk > 0} />
      </div>

      <Tabs defaultValue="protect" className="w-full">
        <TabsList>
          <TabsTrigger value="thesis"><TrendingUp className="h-4 w-4 mr-1.5" /> Thesis</TabsTrigger>
          <TabsTrigger value="protect"><ShieldCheck className="h-4 w-4 mr-1.5" /> Protect list</TabsTrigger>
          <TabsTrigger value="triage"><ScatterIcon className="h-4 w-4 mr-1.5" /> Triage</TabsTrigger>
          <TabsTrigger value="shadow"><ListChecks className="h-4 w-4 mr-1.5" /> Shadow list</TabsTrigger>
        </TabsList>

        <TabsContent value="thesis" className="mt-4"><ThesisView pareto={pareto} /></TabsContent>
        <TabsContent value="protect" className="mt-4"><ProtectList rows={filtered} weeks={weeks} /></TabsContent>
        <TabsContent value="triage" className="mt-4"><TriageView rows={filtered} /></TabsContent>
        <TabsContent value="shadow" className="mt-4"><ShadowList rows={filtered} /></TabsContent>
      </Tabs>
    </div>
  );
}

function MiniCard({ label, value, hint, accent, warn }: { label: string; value: string; hint: string; accent?: boolean; warn?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground font-medium">{label}</CardTitle></CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${accent ? "text-pd-accent" : warn ? "text-destructive" : ""}`}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// View 1 — Pareto thesis
// ---------------------------------------------------------------------------
function ThesisView({ pareto }: { pareto: { pts: { x: number; cumPct: number }[]; total: number; count: number; n80: number; pct80: number } }) {
  const diag = [{ x: 0, even: 0 }, { x: 100, even: 100 }];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          <span className="text-pd-accent font-bold">{pareto.n80}</span> SKUs make 80% of profit
          <span className="text-muted-foreground font-normal text-sm"> — that's {pareto.pct80.toFixed(1)}% of {pareto.count} costed SKUs ({gbp(pareto.total)} total)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={360}>
          <LineChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis type="number" dataKey="x" domain={[0, 100]} tickFormatter={(v) => `${Math.round(v)}%`}
              fontSize={11} label={{ value: "% of SKUs (ranked by profit)", position: "insideBottom", offset: -4, fontSize: 11 }} />
            <YAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} fontSize={11} width={44}
              label={{ value: "cumulative % profit", angle: -90, position: "insideLeft", fontSize: 11 }} />
            <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} labelFormatter={(v: number) => `${Number(v).toFixed(1)}% of SKUs`} />
            <ReferenceLine y={80} stroke="hsl(var(--pd-accent))" strokeDasharray="4 4" label={{ value: "80% profit", fontSize: 10, fill: "hsl(var(--pd-accent))" }} />
            <ReferenceLine x={pareto.pct80} stroke="hsl(var(--pd-accent))" strokeDasharray="4 4" label={{ value: `${pareto.pct80.toFixed(0)}%`, fontSize: 10, fill: "hsl(var(--pd-accent))", position: "top" }} />
            <Line data={diag} dataKey="even" stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" dot={false} strokeWidth={1} name="even" isAnimationActive={false} />
            <Line data={pareto.pts} dataKey="cumPct" stroke="hsl(var(--pd-accent))" dot={false} strokeWidth={2.5} name="cumulative" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-muted-foreground mt-2">
          The steeper the early climb, the more concentrated the profit. The faint diagonal is "if every SKU earned the same".
          The vital few left of the guide-line are the ones to protect.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// View 2 — Protect list leaderboard
// ---------------------------------------------------------------------------
function ProtectList({ rows, weeks }: { rows: Row[]; weeks: number }) {
  const [sort, setSort] = useState<SortKey>("profit_per_week");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [open, setOpen] = useState<string | null>(null);
  const createTask = useCreateTask();

  const sorted = useMemo(() => {
    const r = [...rows];
    r.sort((a, b) => {
      const av = (a[sort] ?? -Infinity) as number; const bv = (b[sort] ?? -Infinity) as number;
      return dir === "desc" ? bv - av : av - bv;
    });
    return r.slice(0, 100);
  }, [rows, sort, dir]);

  const toggleSort = (k: SortKey) => {
    if (sort === k) setDir(dir === "desc" ? "asc" : "desc");
    else { setSort(k); setDir(k === "stock_cover_days" ? "asc" : "desc"); }
  };
  const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={`cursor-pointer select-none ${className ?? ""}`} onClick={() => toggleSort(k)}>
      {children}{sort === k ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </TableHead>
  );

  const spawn = (r: Row) => {
    const atRisk = r.stock_cover_days != null && r.stock_cover_days < 7;
    const oos = (r.on_hand ?? 0) <= 0;
    const isReorder = atRisk && r.profit_per_week > 0;   // proven earner running low/out
    const qty = reorderQty(r);
    const kind = isReorder ? "reorder" : r.overstock ? "trapped-capital" : "review";

    const why = isReorder
      ? `Proven earner ${oos ? "OUT OF STOCK" : `low (${r.stock_cover_days}d cover)`} at ${num(r.avg_weekly_units, 1)} u/wk — reorder to protect ${gbp2(r.profit_per_week)}/wk of profit.${qty ? ` Suggested qty ≈ ${qty} (to target holding).` : ""}`
      : r.overstock
      ? `Over-invested winner: ${gbp(r.trapped_capital)} trapped vs target holding — consider trimming the next order.`
      : `Vital-few SKU — review.`;
    const title = isReorder
      ? `80:20 REORDER — ${r.base_sku}${oos ? " (out of stock)" : " (low cover)"}${qty ? ` · ~${qty}` : ""}`
      : `80:20 — ${r.base_sku}: ${r.overstock ? "trapped capital" : "review"}`;

    createTask.mutate({
      title,
      description: `${r.product_name ?? r.base_sku}\nProfit ${gbp2(r.profit_per_week)}/wk · ${gbp(r.capital)} capital · on hand ${num(r.on_hand)} · cover ${r.stock_cover_days ?? "—"}d.\n${why}`,
      priority_level: isReorder ? 2 : 3,
      user_urgency_flag: isReorder,
      linked_entity_type: "sku",
      linked_entity_id: r.base_sku,
      linked_entity_label: r.base_sku,
      tags: ["80-20", kind],
    } as any);
  };

  return (
    <Card>
      <CardContent className="p-0">
        <Table containerClassName="max-h-[calc(100vh-360px)]">
          <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
            <TableRow>
              <TableHead className="w-6"></TableHead>
              <TableHead>SKU / name</TableHead>
              <TableHead className="text-right">u/wk</TableHead>
              <SortHead k="profit_per_week" className="text-right">Profit/wk</SortHead>
              <TableHead>Tier</TableHead>
              <SortHead k="stock_cover_days" className="text-right">Stock</SortHead>
              <TableHead className="text-center">Listing</TableHead>
              <SortHead k="capital_efficiency" className="text-right">£/£ locked</SortHead>
              <SortHead k="weeks_in_top_tier" className="text-center">Top tier</SortHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => {
              const band = classifyBand(r.por_pct);
              const rag = coverRag(r.stock_cover_days);
              const atRisk = r.stock_cover_days != null && r.stock_cover_days < 7;
              const isOpen = open === r.base_sku;
              return (
                <>
                  <TableRow key={r.base_sku} className={atRisk ? "border-l-2 border-l-destructive bg-destructive/5" : ""}>
                    <TableCell className="py-1.5">
                      <button onClick={() => setOpen(isOpen ? null : r.base_sku)} className="text-muted-foreground">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Link to={skuLink(r.base_sku)} className="font-mono text-xs text-pd-accent hover:underline">{r.base_sku}</Link>
                      <div className="text-xs text-muted-foreground truncate max-w-[280px]">{r.product_name}{r.brand_name ? ` · ${r.brand_name}` : ""}</div>
                    </TableCell>
                    <TableCell className="text-right text-sm">{num(r.units / weeks, 1)}</TableCell>
                    <TableCell className="text-right font-medium">{gbp2(r.profit_per_week)}</TableCell>
                    <TableCell><Badge variant="secondary" className={band.cls}>{band.label}</Badge></TableCell>
                    <TableCell className={`text-right text-sm ${rag.cls}`}>{rag.label}</TableCell>
                    <TableCell className="text-center">
                      <TooltipProvider><UITooltip><TooltipTrigger asChild>
                        <span className="text-muted-foreground text-sm cursor-help">—</span>
                      </TooltipTrigger><TooltipContent>Listing-quality signal not yet built</TooltipContent></UITooltip></TooltipProvider>
                    </TableCell>
                    <TableCell className="text-right text-sm">{r.capital_efficiency == null ? "—" : `£${r.capital_efficiency.toFixed(2)}`}</TableCell>
                    <TableCell className="text-center text-sm">{r.weeks_in_top_tier}/{weeks}</TableCell>
                    <TableCell className="text-right py-1.5">
                      <Button size="sm" variant="ghost" onClick={() => spawn(r)} title="Create task">
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow className="bg-muted/30">
                      <TableCell></TableCell>
                      <TableCell colSpan={9} className="py-2">
                        <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs">
                          <Detail label="Capital tied up" value={gbp(r.capital)} />
                          <Detail label="Targeted capital" value={gbp(r.targeted_capital)} />
                          <Detail label="Trapped capital" value={gbp(r.trapped_capital)} warn={!!r.trapped_capital && r.overstock} />
                          <Detail label="On hand" value={`${num(r.on_hand)} u`} />
                          <Detail label="Avg velocity" value={`${num(r.avg_weekly_units, 1)} u/wk`} />
                          <Detail label="Landed cost" value={gbp2(r.cost_each)} />
                          <Detail label="POR" value={r.por_pct == null ? "—" : `${r.por_pct.toFixed(1)}%`} />
                          {reorderQty(r) != null && r.profit_per_week > 0 && (r.stock_cover_days == null || r.stock_cover_days < 21) &&
                            <Detail label="Suggested reorder" value={`≈ ${reorderQty(r)} u`} warn={(r.on_hand ?? 0) <= 0} />}
                          {r.overstock && <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400">Overstocked</Badge>}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
        {sorted.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">No SKUs match.</div>}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <div><span className="text-muted-foreground">{label}: </span><span className={warn ? "text-destructive font-medium" : "font-medium"}>{value}</span></div>;
}

// ---------------------------------------------------------------------------
// View 3 — Triage quadrant scatter
// ---------------------------------------------------------------------------
function TriageView({ rows }: { rows: Row[] }) {
  const [axis, setAxis] = useState<"cover" | "capital">("cover");
  const pts = useMemo(() => rows
    .filter((r) => r.profit_per_week > 0)
    .map((r) => ({
      x: axis === "cover" ? (r.stock_cover_days ?? 60) : (r.capital ?? 0),
      y: r.profit_per_week,
      z: r.capital,
      sku: r.base_sku, name: r.product_name,
      risk: axis === "cover" ? (r.stock_cover_days != null && r.stock_cover_days < 7) : r.overstock,
    }))
    .slice(0, 400), [rows, axis]);

  const maxX = axis === "cover" ? 60 : Math.max(1, ...pts.map((p) => p.x));

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          {axis === "cover" ? "Protect-now: high profit + low stock cover" : "Over-invested: high profit + high capital"}
        </CardTitle>
        <div className="flex gap-1">
          <Button size="sm" variant={axis === "cover" ? "default" : "outline"} onClick={() => setAxis("cover")}>Stock cover</Button>
          <Button size="sm" variant={axis === "capital" ? "default" : "outline"} onClick={() => setAxis("capital")}>Capital</Button>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart margin={{ top: 8, right: 16, left: 8, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis type="number" dataKey="x" name={axis === "cover" ? "cover (days)" : "capital £"} domain={axis === "cover" ? [0, 60] : [0, maxX]}
              tickFormatter={(v) => axis === "cover" ? `${v}d` : `£${Math.round(v / 1000)}k`} fontSize={11}
              label={{ value: axis === "cover" ? "stock cover (days, capped 60)" : "capital tied up", position: "insideBottom", offset: -6, fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name="profit/wk" tickFormatter={(v) => `£${v}`} fontSize={11} width={50}
              label={{ value: "profit £/wk", angle: -90, position: "insideLeft", fontSize: 11 }} />
            <ZAxis type="number" dataKey="z" range={[30, 400]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return (
                <div className="rounded border bg-background p-2 text-xs shadow">
                  <div className="font-mono text-pd-accent">{p.sku}</div>
                  <div className="text-muted-foreground max-w-[200px] truncate">{p.name}</div>
                  <div>Profit {gbp2(p.y)}/wk</div>
                  <div>{axis === "cover" ? `Cover ${p.x}d` : `Capital ${gbp(p.x)}`}</div>
                </div>
              );
            }} />
            {axis === "cover" && <ReferenceArea x1={0} x2={7} fill="hsl(var(--destructive))" fillOpacity={0.08} label={{ value: "protect now", fontSize: 10, fill: "hsl(var(--destructive))" }} />}
            <Scatter data={pts}>
              {pts.map((p, i) => <Cell key={i} fill={p.risk ? "hsl(var(--destructive))" : "hsl(var(--pd-accent))"} fillOpacity={0.65} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-muted-foreground mt-2">
          {axis === "cover"
            ? "Top-left red zone = earners about to run out. Bubble size = capital tied up."
            : "Top-right = winners we're over-invested in (high profit, lots of capital locked). Red = flagged overstock."}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// View 4 — Shadow / cull list
// ---------------------------------------------------------------------------
function ShadowList({ rows }: { rows: Row[] }) {
  const shadow = useMemo(() => rows
    .filter((r) => (r.por_pct != null && r.por_pct < 1) || r.profit_per_week <= 0)
    .sort((a, b) => (b.capital || 0) - (a.capital || 0))
    .slice(0, 100), [rows]);
  const lockedUp = shadow.reduce((s, r) => s + (r.capital || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Boxes className="h-4 w-4 text-muted-foreground" /> Run-down / delist tail
          <span className="text-sm font-normal text-muted-foreground">— {gbp(lockedUp)} locked in {shadow.length} loss/breakeven SKUs</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table containerClassName="max-h-[calc(100vh-360px)]">
          <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
            <TableRow>
              <TableHead>SKU / name</TableHead>
              <TableHead className="text-right">Profit/wk</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead className="text-right">Capital tied up</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Cover</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shadow.map((r) => {
              const band = classifyBand(r.por_pct);
              return (
                <TableRow key={r.base_sku}>
                  <TableCell className="py-1.5">
                    <Link to={skuLink(r.base_sku)} className="font-mono text-xs text-pd-accent hover:underline">{r.base_sku}</Link>
                    <div className="text-xs text-muted-foreground truncate max-w-[280px]">{r.product_name}{r.brand_name ? ` · ${r.brand_name}` : ""}</div>
                  </TableCell>
                  <TableCell className={`text-right ${r.profit_per_week < 0 ? "text-destructive" : ""}`}>{gbp2(r.profit_per_week)}</TableCell>
                  <TableCell><Badge variant="secondary" className={band.cls}>{band.label}</Badge></TableCell>
                  <TableCell className="text-right font-medium">{gbp(r.capital)}</TableCell>
                  <TableCell className="text-right text-sm">{num(r.on_hand)}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{r.stock_cover_days == null ? "—" : `${r.stock_cover_days}d`}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {shadow.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">No loss/breakeven tail in this window. 🎉</div>}
      </CardContent>
    </Card>
  );
}
