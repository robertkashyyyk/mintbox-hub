import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useToast } from "@/hooks/use-toast";

interface SnapshotRow {
  iso_year: number;
  iso_week: number;
  week_start: string;
  week_end: string;
  revenue: number;
  qty: number;
  order_count: number;
  line_count: number;
  courier_cost_total: number;
  channel_fees_total: number;
  cost_total: number;
  profit: number;
  por_pct: number | null;
  aov: number | null;
  good_count: number;
  dirt_count: number;
  missing_cost_count: number;
}

const gbp = (v: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v || 0);
const num = (v: number) => new Intl.NumberFormat("en-GB").format(Math.round(v || 0));
const pct = (v: number | null) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;

const ProfitGraphs = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("profit_weekly_snapshots")
      .select("iso_year, iso_week, week_start, week_end, revenue, qty, order_count, line_count, courier_cost_total, channel_fees_total, cost_total, profit, por_pct, aov, good_count, dirt_count, missing_cost_count")
      .order("iso_year", { ascending: true })
      .order("iso_week", { ascending: true })
      .limit(260);
    if (error) toast({ title: "Failed to load snapshots", description: error.message, variant: "destructive" });
    else setRows((data ?? []) as SnapshotRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const snapshotNow = async () => {
    setBusy(true);
    const { error } = await (supabase as any).rpc("snapshot_profit_current_week");
    setBusy(false);
    if (error) toast({ title: "Snapshot failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Current week snapshot updated" }); load(); }
  };

  const rebuildAll = async () => {
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("backfill_profit_weekly_snapshots");
    setBusy(false);
    if (error) toast({ title: "Backfill failed", description: error.message, variant: "destructive" });
    else { toast({ title: `Rebuilt ${data ?? 0} weekly snapshots` }); load(); }
  };

  const chartData = useMemo(() => rows.map((r) => ({
    week: `${r.iso_year}-W${String(r.iso_week).padStart(2, "0")}`,
    revenue: Number(r.revenue),
    profit: Number(r.profit),
    cost: Number(r.cost_total),
    courier: Number(r.courier_cost_total),
    fees: Number(r.channel_fees_total),
    por_pct: r.por_pct == null ? null : Number(r.por_pct) * 100,
    orders: Number(r.order_count),
    qty: Number(r.qty),
    aov: r.aov == null ? null : Number(r.aov),
    good: Number(r.good_count),
    dirt: Number(r.dirt_count),
    missing: Number(r.missing_cost_count),
  })), [rows]);

  const latest = rows.length > 0 ? rows[rows.length - 1] : undefined;
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  const delta = (cur?: number | null, prev?: number | null) => {
    if (cur == null || prev == null || prev === 0) return null;
    const d = ((cur - prev) / prev) * 100;
    return { pct: d, up: d >= 0 };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/intelligence/profit"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Profit — Graphs</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={rebuildAll} disabled={busy}>
            <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />
            Rebuild all weeks
          </Button>
          <Button variant="outline" size="sm" onClick={snapshotNow} disabled={busy}>
            <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />
            Snapshot current week
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Backfilled from historical order economics. Snapshots refresh automatically every Sunday at 23:59 UTC and are
        stored against the ISO week (e.g. <code>2026-W21</code>).
      </p>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading snapshots…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No snapshots yet.</CardContent></Card>
      ) : (
        <>
          {latest && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Revenue", value: gbp(latest.revenue), d: delta(latest.revenue, previous?.revenue) },
                { label: "Profit", value: gbp(latest.profit), d: delta(latest.profit, previous?.profit) },
                { label: "POR %", value: pct(latest.por_pct), d: delta(latest.por_pct, previous?.por_pct) },
                { label: "Orders", value: num(latest.order_count), d: delta(latest.order_count, previous?.order_count) },
              ].map((t) => (
                <div key={t.label} className="rounded-md border-2 border-border bg-card p-4">
                  <div className="text-xs uppercase tracking-wide text-foreground/60">{t.label}</div>
                  <div className="text-2xl font-bold mt-1 text-foreground">{t.value}</div>
                  {t.d && (
                    <div className={`text-xs mt-1 ${t.d.up ? "text-pd-accent" : "text-destructive"}`}>
                      {t.d.up ? "▲" : "▼"} {Math.abs(t.d.pct).toFixed(1)}% WoW
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Revenue & Profit */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-pd-accent" />
                <CardTitle>Revenue & profit</CardTitle>
              </div>
              <CardDescription>Weekly revenue with profit and POR % overlaid</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => gbp(v)} />
                  <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    formatter={(v: number, name: string) => name === "POR %" ? `${v.toFixed(1)}%` : gbp(v)}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="revenue" fill="hsl(217 90% 60%)" name="Revenue" />
                  <Bar yAxisId="left" dataKey="profit" fill="hsl(var(--pd-accent))" name="Profit" />
                  <Line yAxisId="right" type="monotone" dataKey="por_pct" stroke="hsl(41 90% 56%)" strokeWidth={2} dot={false} name="POR %" />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Cost breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Cost breakdown</CardTitle>
              <CardDescription>Stacked product cost, courier, and channel fees</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => gbp(v)} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => gbp(v)} />
                  <Legend />
                  <Area type="monotone" dataKey="cost" stackId="1" stroke="hsl(265 80% 65%)" fill="hsl(265 80% 65%)" fillOpacity={0.55} name="Product cost" />
                  <Area type="monotone" dataKey="courier" stackId="1" stroke="hsl(25 85% 55%)" fill="hsl(25 85% 55%)" fillOpacity={0.55} name="Courier" />
                  <Area type="monotone" dataKey="fees" stackId="1" stroke="hsl(0 75% 60%)" fill="hsl(0 75% 60%)" fillOpacity={0.55} name="Channel fees" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Orders & units</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={num} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => num(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="orders" stroke="hsl(217 90% 60%)" strokeWidth={2} dot={false} name="Orders" />
                    <Line type="monotone" dataKey="qty" stroke="hsl(var(--pd-accent))" strokeWidth={2} dot={false} name="Units" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Data quality</CardTitle><CardDescription>Lines flagged as dirt or missing cost</CardDescription></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={num} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => num(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="dirt" stroke="hsl(0 75% 60%)" strokeWidth={2} dot={false} name="Dirt lines" />
                    <Line type="monotone" dataKey="missing" stroke="hsl(41 90% 56%)" strokeWidth={2} dot={false} name="Missing-cost lines" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Average order value</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => gbp(v)} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => gbp(v)} />
                  <Line type="monotone" dataKey="aov" stroke="hsl(var(--pd-accent))" strokeWidth={2} dot={false} name="AOV" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default ProfitGraphs;
