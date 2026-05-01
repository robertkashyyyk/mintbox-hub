import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, ChevronLeft, ChevronRight, AlertTriangle, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";

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

  const { data: lines, isLoading: linesLoading } = useQuery({
    queryKey: ["profit-lines", year, week, refetchKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_line_economics")
        .select("mintsoft_order_id, line_index, sku, product_name, channel, qty, price, order_value, cost_each, courier_cost, channel_fee, profit, por_pct, good_dirt, missing_cost, courier, fee_rule_name")
        .eq("iso_year", year)
        .eq("iso_week", week)
        .order("profit", { ascending: true })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

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
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-pd-accent" />
            Profit Intelligence
          </h1>
          <p className="text-sm text-foreground/60 mt-1">
            Weekly revenue, costs, channel fees, courier spend and POR — calculated from live order lines.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <CardTitle className="text-base">Profitability segmentation (per line, by POR %)</CardTitle>
          <CardDescription>
            Order lines bucketed by their POR % (profit ÷ GMV inc VAT). Thresholds editable in <Link to="/admin/profit-rules" className="underline text-pd-accent">Profit Rules</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bandsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {[...Array(7)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {(["loss","breakeven","poor","average","good","great","amazing"] as const).map((b) => {
                const row = (bands ?? []).find((x: any) => x.band === b);
                const meta: Record<string, { label: string; tone: string }> = {
                  loss:      { label: "Loss",      tone: "border-band-loss/60 bg-band-loss/15" },
                  breakeven: { label: "Breakeven", tone: "border-band-breakeven/60 bg-band-breakeven/15" },
                  poor:      { label: "Poor",      tone: "border-band-poor/60 bg-band-poor/15" },
                  average:   { label: "Average",   tone: "border-band-average/60 bg-band-average/15" },
                  good:      { label: "Good",      tone: "border-band-good/60 bg-band-good/15" },
                  great:     { label: "Great",     tone: "border-band-great/60 bg-band-great/15" },
                  amazing:   { label: "Amazing",   tone: "border-band-amazing/70 bg-band-amazing/20" },
                };
                const m = meta[b];
                return (
                  <div key={b} className={`rounded-md border p-3 ${m.tone}`}>
                    <div className="text-xs uppercase tracking-wide text-foreground/60">{m.label}</div>
                    <div className="text-xl font-bold text-foreground mt-1">{fmtNum(row?.line_count ?? 0)}</div>
                    <div className="text-xs text-foreground/70 mt-0.5">{Number(row?.pct ?? 0).toFixed(1)}% of lines</div>
                    <div className="text-xs font-mono text-foreground/80 mt-1">{fmtGBP(row?.profit_total ?? 0)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lines this week — sorted by lowest profit</CardTitle>
          <CardDescription>Top 100 worst-margin lines for {weekKey}.</CardDescription>
        </CardHeader>
        <CardContent>
          {linesLoading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (lines?.length ?? 0) === 0 ? (
            <div className="text-sm text-foreground/60 py-6 text-center">
              No order lines for this week yet. If this is recent data, run a backfill.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Courier</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">POR</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines!.map((l: any, i: number) => (
                    <TableRow key={`${l.mintsoft_order_id}-${l.line_index}-${i}`}>
                      <TableCell className="font-mono text-xs">{l.mintsoft_order_id}</TableCell>
                      <TableCell className="font-medium">{l.sku}</TableCell>
                      <TableCell className="text-xs text-foreground/70">{l.channel ?? "—"}</TableCell>
                      <TableCell className="text-right">{l.qty}</TableCell>
                      <TableCell className="text-right">{fmtGBP(l.price)}</TableCell>
                      <TableCell className="text-right">{fmtGBP(l.cost_each)}</TableCell>
                      <TableCell className="text-right">{fmtGBP(l.courier_cost)}</TableCell>
                      <TableCell className="text-right">{fmtGBP(l.channel_fee)}</TableCell>
                      <TableCell className={`text-right font-semibold ${Number(l.profit) < 0 ? "text-destructive" : "text-foreground"}`}>
                        {fmtGBP(l.profit)}
                      </TableCell>
                      <TableCell className="text-right">{fmtPct(l.por_pct)}</TableCell>
                      <TableCell className="space-x-1">
                        {l.missing_cost && <Badge variant="destructive" className="text-[10px]">no cost</Badge>}
                        {l.good_dirt === "Dirt" && <Badge variant="outline" className="text-[10px] border-warning text-warning">dirt</Badge>}
                        {Number(l.profit ?? 0) < 0 && <Badge variant="outline" className="text-[10px] border-destructive text-destructive">loss</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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

export default ProfitDashboard;
