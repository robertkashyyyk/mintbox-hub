import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw, TrendingUp } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useToast } from "@/hooks/use-toast";

interface SnapshotRow {
  iso_year: number;
  iso_week: number;
  week_start: string;
  week_end: string;
  total_skus: number;
  total_units: number;
  total_value: number;
  missing_cost_skus: number;
  missing_cost_units: number;
  avg_value_per_sku: number;
  by_category: Record<string, { skus: number; units: number; value: number }>;
}

const gbp = (v: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v || 0);
const num = (v: number) => new Intl.NumberFormat("en-GB").format(Math.round(v || 0));

const CAT_COLORS: Record<string, string> = {
  Healthy: "hsl(142 70% 45%)",
  Overstock: "hsl(217 90% 60%)",
  "Extreme Overstock": "hsl(265 80% 65%)",
  Unhealthy: "hsl(41 90% 56%)",
  "Low Stock": "hsl(25 85% 55%)",
  Critical: "hsl(0 75% 60%)",
  "Out of Stock": "hsl(0 60% 45%)",
  "Dead Stock": "hsl(220 10% 50%)",
  "Non Selling": "hsl(220 10% 35%)",
  "Missing Baseline": "hsl(41 90% 56%)",
  Unknown: "hsl(220 8% 45%)",
};

const PLOT_CATEGORIES = [
  "Healthy", "Overstock", "Extreme Overstock", "Unhealthy",
  "Low Stock", "Critical", "Out of Stock", "Dead Stock",
];

const StockValuationGraphs = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapping, setSnapping] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("stock_valuation_weekly_snapshots")
      .select("iso_year, iso_week, week_start, week_end, total_skus, total_units, total_value, missing_cost_skus, missing_cost_units, avg_value_per_sku, by_category")
      .order("iso_year", { ascending: true })
      .order("iso_week", { ascending: true })
      .limit(260);
    if (error) {
      toast({ title: "Failed to load snapshots", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as SnapshotRow[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const snapshotNow = async () => {
    setSnapping(true);
    const { error } = await (supabase as any).rpc("snapshot_stock_valuation");
    setSnapping(false);
    if (error) {
      toast({ title: "Snapshot failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Snapshot captured" });
      load();
    }
  };

  const chartData = useMemo(() => rows.map((r) => {
    const base: any = {
      week: `${r.iso_year}-W${String(r.iso_week).padStart(2, "0")}`,
      total_value: Number(r.total_value),
      total_units: Number(r.total_units),
      total_skus: Number(r.total_skus),
      missing_cost_skus: Number(r.missing_cost_skus),
      missing_cost_units: Number(r.missing_cost_units),
      avg_value_per_sku: Number(r.avg_value_per_sku),
    };
    for (const cat of PLOT_CATEGORIES) {
      base[`val_${cat}`] = Number(r.by_category?.[cat]?.value ?? 0);
      base[`skus_${cat}`] = Number(r.by_category?.[cat]?.skus ?? 0);
    }
    return base;
  }), [rows]);

  const latest = rows.at(-1);
  const previous = rows.length > 1 ? rows.at(-2) : null;
  const delta = (cur?: number, prev?: number | null) => {
    if (cur == null || prev == null || prev === 0) return null;
    const pct = ((cur - prev) / prev) * 100;
    return { pct, up: pct >= 0 };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/intelligence/stock-valuation"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Stock Valuation — Graphs</h1>
        </div>
        <Button variant="outline" size="sm" onClick={snapshotNow} disabled={snapping}>
          <RefreshCw className={`h-4 w-4 mr-2 ${snapping ? "animate-spin" : ""}`} />
          Snapshot now
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Snapshots are captured automatically every Sunday at 23:59 UTC and stored against the ISO week (e.g. <code>2026-W21</code>).
        Use <em>Snapshot now</em> to capture an extra data point on demand.
      </p>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading snapshots…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          No snapshots yet. Click <strong>Snapshot now</strong> to capture the first data point.
        </CardContent></Card>
      ) : (
        <>
          {/* Headline tiles with WoW delta */}
          {latest && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total stock value", value: gbp(latest.total_value), d: delta(latest.total_value, previous?.total_value) },
                { label: "Units on hand", value: num(latest.total_units), d: delta(latest.total_units, previous?.total_units) },
                { label: "Missing cost SKUs", value: num(latest.missing_cost_skus), d: delta(latest.missing_cost_skus, previous?.missing_cost_skus), invert: true },
                { label: "Avg value / SKU", value: gbp(latest.avg_value_per_sku), d: delta(latest.avg_value_per_sku, previous?.avg_value_per_sku) },
              ].map((t) => (
                <div key={t.label} className="rounded-md border-2 border-border bg-card p-4">
                  <div className="text-xs uppercase tracking-wide text-foreground/60">{t.label}</div>
                  <div className="text-2xl font-bold mt-1 text-foreground">{t.value}</div>
                  {t.d && (
                    <div className={`text-xs mt-1 ${
                      (t.invert ? !t.d.up : t.d.up) ? "text-pd-accent" : "text-destructive"
                    }`}>
                      {t.d.up ? "▲" : "▼"} {Math.abs(t.d.pct).toFixed(1)}% WoW
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Total value over time */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-pd-accent" />
                <CardTitle>Total stock value</CardTitle>
              </div>
              <CardDescription>Net value at cost, by ISO week</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <defs>
                    <linearGradient id="gValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--pd-accent))" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="hsl(var(--pd-accent))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => gbp(v)} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    formatter={(v: number) => gbp(v)}
                  />
                  <Area type="monotone" dataKey="total_value" stroke="hsl(var(--pd-accent))" fill="url(#gValue)" name="Total value" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Units + SKUs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Units on hand</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={num} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => num(v)} />
                    <Line type="monotone" dataKey="total_units" stroke="hsl(217 90% 60%)" strokeWidth={2} dot={false} name="Units" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Missing cost (SKUs &amp; units)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={num} />
                    <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={num} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => num(v)} />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="missing_cost_skus" stroke="hsl(41 90% 56%)" strokeWidth={2} dot={false} name="SKUs" />
                    <Line yAxisId="right" type="monotone" dataKey="missing_cost_units" stroke="hsl(0 75% 60%)" strokeWidth={2} dot={false} name="Units" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Value by category */}
          <Card>
            <CardHeader>
              <CardTitle>Value by health category</CardTitle>
              <CardDescription>Stacked area of cost-value by health bucket</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => gbp(v)} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => gbp(v)} />
                  <Legend />
                  {PLOT_CATEGORIES.map((cat) => (
                    <Area
                      key={cat}
                      type="monotone"
                      dataKey={`val_${cat}`}
                      stackId="1"
                      stroke={CAT_COLORS[cat]}
                      fill={CAT_COLORS[cat]}
                      fillOpacity={0.5}
                      name={cat}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* SKUs by category */}
          <Card>
            <CardHeader>
              <CardTitle>SKUs by health category</CardTitle>
              <CardDescription>How the in-stock SKU mix shifts week to week</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={num} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => num(v)} />
                  <Legend />
                  {PLOT_CATEGORIES.map((cat) => (
                    <Line
                      key={cat}
                      type="monotone"
                      dataKey={`skus_${cat}`}
                      stroke={CAT_COLORS[cat]}
                      strokeWidth={2}
                      dot={false}
                      name={cat}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default StockValuationGraphs;
