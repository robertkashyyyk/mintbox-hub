/**
 * Despatch KPIs — operational health of the despatch pipeline.
 * Replaces the manual "Despatch KPIs" spreadsheet (Daily KPIs + Monthly KPIs).
 *
 * Tabs:
 *   Queue Health — daily New/Backorder/Despatched + drift & cumulative drift
 *                  (are we keeping up?), from order_status_snapshots + history
 *   SLA          — headline <24/<48/<72h rates + link to the full report
 *   Late SKUs    — which SKUs most often sit in 48h+ orders (stock remediation)
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  format, startOfMonth, endOfMonth, subDays,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link as LinkIcon, Truck, Activity, TrendingUp, TrendingDown, AlertTriangle, ExternalLink, Package, Download } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

const fmtDate = (d: Date) => format(d, "yyyy-MM-dd");

// ═════════════════════════════════════════════════════════════════
export default function DespatchKpis() {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Despatch KPIs"
        description="Queue health, SLA performance and the SKUs holding up despatch."
        icon={Truck}
      />
      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue"><Activity className="h-4 w-4 mr-2" />Queue Health</TabsTrigger>
          <TabsTrigger value="sla"><TrendingUp className="h-4 w-4 mr-2" />SLA Performance</TabsTrigger>
          <TabsTrigger value="late"><Package className="h-4 w-4 mr-2" />Late SKUs</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-6"><QueueHealthTab /></TabsContent>
        <TabsContent value="sla" className="mt-6"><SlaTab /></TabsContent>
        <TabsContent value="late" className="mt-6"><LateSkusTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Queue Health
// ═════════════════════════════════════════════════════════════════
interface QueueRow {
  day: string;
  new_count: number;
  onbackorder_count: number;
  awaitingpicking_count: number;
  despatched: number;
  drift: number;
  drift_cumulative: number;
}

function QueueHealthTab() {
  const [days, setDays] = useState(30);
  const to = new Date();
  const from = subDays(to, days);

  const { data = [], isLoading } = useQuery({
    queryKey: ["queue-health", days],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_queue_health_daily", {
        from_date: fmtDate(from), to_date: fmtDate(to),
      });
      if (error) throw error;
      return data as QueueRow[];
    },
  });

  const chartData = useMemo(() => data.map(r => ({
    day: format(new Date(r.day), "dd MMM"),
    New: r.new_count,
    Despatched: r.despatched,
    Backorder: r.onbackorder_count,
    Drift: r.drift,
    "Cumulative Drift": r.drift_cumulative,
  })), [data]);

  const latest = data[data.length - 1];
  const hasSnapshots = data.some(r => r.new_count > 0 || r.onbackorder_count > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">
          Drift = New orders − Despatched. Positive drift means the backlog is growing.
        </p>
        <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!hasSnapshots && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-400">Queue snapshots are still building up</p>
            <p className="text-xs text-muted-foreground mt-1">
              New/Backorder counts are captured twice daily (06:30 &amp; 16:30). Despatch volume is shown from history. The drift view fills in over the coming days as snapshots accumulate.
            </p>
          </div>
        </div>
      )}

      {/* KPI cards */}
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="New (latest)" value={latest.new_count} />
          <KpiCard label="On back order" value={latest.onbackorder_count} className="text-amber-400" />
          <KpiCard label="Despatched (latest day)" value={latest.despatched} className="text-emerald-400" />
          <KpiCard
            label="Cumulative drift"
            value={latest.drift_cumulative}
            className={latest.drift_cumulative > 0 ? "text-destructive" : "text-emerald-400"}
            icon={latest.drift_cumulative > 0 ? TrendingUp : TrendingDown}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Daily flow</CardTitle>
          <CardDescription>New orders in vs despatched out, with cumulative drift line</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <PageLoader rows={6} columns={[80, 80, 80, 80]} label="Loading queue health" /> :
            chartData.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">No data in this range yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="New" fill="hsl(var(--pd-accent))" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="left" dataKey="Despatched" fill="hsl(var(--success))" radius={[2, 2, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="Cumulative Drift" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
        </CardContent>
      </Card>

      {/* Daily table */}
      <Card>
        <CardHeader><CardTitle>Daily detail</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">New</TableHead>
                  <TableHead className="text-right">Back order</TableHead>
                  <TableHead className="text-right">Awaiting picking</TableHead>
                  <TableHead className="text-right">Despatched</TableHead>
                  <TableHead className="text-right">Drift</TableHead>
                  <TableHead className="text-right">Cumulative</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data].reverse().map(r => (
                  <TableRow key={r.day}>
                    <TableCell className="font-mono text-sm">{format(new Date(r.day), "EEE dd MMM")}</TableCell>
                    <TableCell className="text-right">{r.new_count || "—"}</TableCell>
                    <TableCell className="text-right text-amber-400">{r.onbackorder_count || "—"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.awaitingpicking_count || "—"}</TableCell>
                    <TableCell className="text-right text-emerald-400">{r.despatched || "—"}</TableCell>
                    <TableCell className={`text-right font-semibold ${r.drift > 0 ? "text-destructive" : r.drift < 0 ? "text-emerald-400" : ""}`}>
                      {r.drift > 0 ? `+${r.drift}` : r.drift}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${r.drift_cumulative > 0 ? "text-destructive" : "text-emerald-400"}`}>
                      {r.drift_cumulative > 0 ? `+${r.drift_cumulative}` : r.drift_cumulative}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// SLA Performance (headline cards + link to full report)
// ═════════════════════════════════════════════════════════════════
function SlaTab() {
  const now = new Date();
  const from = startOfMonth(now);
  const to = endOfMonth(now);

  const { data = [], isLoading } = useQuery({
    queryKey: ["despatch-sla-mtd", fmtDate(from), fmtDate(to)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_despatch_performance_buckets" as any, {
        from_date: fmtDate(from), to_date: fmtDate(to), bucket: "month", channels: null,
      });
      if (error) throw error;
      return data as any[];
    },
  });

  const total = data.find(r => r.channel === null);
  const pct = (n: number, t: number) => t > 0 ? (n / t) * 100 : 0;
  const tierClass = (p: number, great: number, ok: number) =>
    p >= great ? "text-emerald-400" : p >= ok ? "text-amber-400" : "text-destructive";

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-muted/20 p-4 flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">
          Month-to-date despatch SLA. Full breakdown by channel and period in the Despatch Performance report.
        </p>
        <Link to="/operations/reports/despatch-performance">
          <Button variant="outline" size="sm">
            <ExternalLink className="h-4 w-4 mr-2" />Full report
          </Button>
        </Link>
      </div>

      {isLoading ? <PageLoader rows={3} columns={[120, 120, 120]} label="Loading SLA data" /> :
        !total ? (
          <p className="text-center text-muted-foreground py-12">No despatches recorded this month yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <KpiCard label="Despatched (MTD)" value={Number(total.total)} />
              <KpiCard label="Within 24h" value={`${pct(Number(total.under_24h), Number(total.total)).toFixed(1)}%`}
                className={tierClass(pct(Number(total.under_24h), Number(total.total)), 40, 25)} />
              <KpiCard label="Within 48h" value={`${pct(Number(total.under_48h), Number(total.total)).toFixed(1)}%`}
                className={tierClass(pct(Number(total.under_48h), Number(total.total)), 75, 60)} />
              <KpiCard label="Within 72h" value={`${pct(Number(total.under_72h), Number(total.total)).toFixed(1)}%`}
                className={tierClass(pct(Number(total.under_72h), Number(total.total)), 95, 90)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <KpiCard label="Median hours" value={total.median_hours ?? "—"} />
              <KpiCard label="Mean hours" value={total.mean_hours ?? "—"} />
              <KpiCard label="Over 72h" value={Number(total.over_72h)}
                className={Number(total.over_72h) > 0 ? "text-destructive" : "text-emerald-400"} />
            </div>
            <p className="text-xs text-muted-foreground">
              Target: 95%+ within 72h. The 72-hour mark is the hard SLA.
            </p>
          </>
        )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Late SKUs
// ═════════════════════════════════════════════════════════════════
interface LateSku {
  sku: string;
  product_name: string | null;
  brand_name: string | null;
  late_orders: number;
  avg_hours: number;
  worst_hours: number;
}

function LateSkusTab() {
  const [days, setDays] = useState(30);
  const [sla, setSla] = useState(48);
  const to = new Date();
  const from = subDays(to, days);

  const { data = [], isLoading } = useQuery({
    queryKey: ["late-skus", days, sla],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_late_despatch_skus", {
        from_date: fmtDate(from), to_date: fmtDate(to), sla_hours: sla, limit_n: 50,
      });
      if (error) throw error;
      return data as LateSku[];
    },
  });

  function downloadCsv() {
    const header = ["SKU", "Product", "Brand", "LateOrders", "AvgHours", "WorstHours"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = data.map(r => [r.sku, r.product_name ?? "", r.brand_name ?? "", r.late_orders, r.avg_hours, r.worst_hours].map(esc).join(","));
    const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `late-skus-over${sla}h-${days}d-${fmtDate(new Date())}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">
          SKUs that most often sit in slow-to-despatch orders — usually a stock or back-order problem. Fix these to lift SLA.
        </p>
        <div className="flex gap-2">
          <Select value={String(sla)} onValueChange={v => setSla(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="24">Over 24h</SelectItem>
              <SelectItem value="48">Over 48h</SelectItem>
              <SelectItem value="72">Over 72h</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={isLoading || data.length === 0}>
            <Download className="h-4 w-4 mr-2" />Download
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <PageLoader rows={10} columns={[120, 220, 100, 80, 80, 80]} label="Loading late SKUs" /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead className="text-right">Late orders</TableHead>
                    <TableHead className="text-right">Avg hours</TableHead>
                    <TableHead className="text-right">Worst</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No SKUs breached this threshold in the range — good news.
                    </TableCell></TableRow>
                  )}
                  {data.map(r => (
                    <TableRow key={r.sku}>
                      <TableCell>
                        <Link to={`/discovery/products?search=${encodeURIComponent(r.sku)}`} className="font-mono text-sm text-pd-accent hover:underline">
                          {r.sku}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm max-w-xs truncate">{r.product_name ?? "—"}</TableCell>
                      <TableCell>
                        {r.brand_name
                          ? <Badge variant="outline" className="bg-primary/10 text-primary text-xs">{r.brand_name}</Badge>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{r.late_orders}</TableCell>
                      <TableCell className="text-right">{r.avg_hours}h</TableCell>
                      <TableCell className={`text-right ${r.worst_hours > 168 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                        {r.worst_hours}h
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
}

// ── Shared KPI card ───────────────────────────────────────────────
function KpiCard({ label, value, className = "", icon: Icon }: {
  label: string; value: number | string; className?: string; icon?: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          {Icon && <Icon className="h-3 w-3" />}{label}
        </div>
        <div className={`text-2xl font-bold mt-1 ${className}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
