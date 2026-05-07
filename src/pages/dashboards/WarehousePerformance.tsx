import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Maximize2,
  RefreshCw,
  Package,
  Clock,
  AlertTriangle,
  Truck,
  Gauge,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useRef } from "react";

const REFRESH_MS = 60_000;
const TARGET_PER_HOUR = 40;

const WarehousePerformance = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Latest snapshot (live truth from Mintsoft, refreshed every 5 min)
  const liveQ = useQuery({
    queryKey: ["wh-latest-snapshot"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_mintsoft_status_latest" as any);
      if (error) throw error;
      const rows = (data as Array<{ status: string; count: number; captured_at: string }>) ?? [];
      const map: Record<string, number> = {};
      let capturedAt: string | null = null;
      for (const r of rows) {
        map[r.status] = Number(r.count);
        if (!capturedAt || r.captured_at > capturedAt) capturedAt = r.captured_at;
      }
      return {
        awaiting: map["AWAITINGPICKING"] ?? 0,
        newOrders: map["NEW"] ?? 0,
        backorder: map["ONBACKORDER"] ?? 0,
        picked: map["PICKED"] ?? 0,
        capturedAt,
      };
    },
  });

  // Hourly snapshot trend today (queue depth over time)
  const trendQ = useQuery({
    queryKey: ["wh-snapshot-hourly"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_status_snapshots_hourly_today" as any);
      if (error) throw error;
      return (data as Array<{
        hr: string;
        new_count: number;
        awaiting_count: number;
        backorder_count: number;
        picked_count: number;
      }>) ?? [];
    },
  });

  // Hourly despatched today
  const desQ = useQuery({
    queryKey: ["wh-despatch-hourly"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_despatch_hourly_today" as any);
      if (error) throw error;
      return (data as Array<{ hr: string; despatched: number }>) ?? [];
    },
  });

  // On-time despatch %
  const perfQ = useQuery({
    queryKey: ["wh-despatch-perf"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_despatch_today_vs_7d" as any);
      if (error) throw error;
      return (data as any[])?.[0] ?? null;
    },
  });

  const live = liveQ.data;
  const perf = perfQ.data as
    | { today_pct: number | null; today_total: number; today_on_time: number; avg7_pct: number | null }
    | null;

  // Build chart rows for 8am–5pm
  const today = new Date();
  const trend = trendQ.data ?? [];
  const desp = desQ.data ?? [];
  const chart = Array.from({ length: 10 }, (_, i) => {
    const h = 8 + i;
    const t = trend.find((r) => new Date(r.hr).getHours() === h);
    const d = desp.find((r) => new Date(r.hr).getHours() === h);
    const isFuture = h > today.getHours();
    return {
      hour: `${String(h).padStart(2, "0")}:00`,
      "Awaiting Picking": isFuture ? null : Number(t?.awaiting_count ?? 0),
      "New": isFuture ? null : Number(t?.new_count ?? 0),
      "Backorder": isFuture ? null : Number(t?.backorder_count ?? 0),
      Despatched: isFuture ? 0 : Number(d?.despatched ?? 0),
    };
  });

  const despatchedToday = desp.reduce((s, r) => s + Number(r.despatched ?? 0), 0);
  const hoursElapsed = Math.max(1, Math.min(9, today.getHours() - 8 + 1));
  const avgPerHour = Math.round(despatchedToday / hoursElapsed);
  const lastHour = desp.find((r) => new Date(r.hr).getHours() === today.getHours() - 1);
  const lastHourCount = Number(lastHour?.despatched ?? 0);

  // Queue trend signal: compare latest awaiting vs first reading today
  const firstAwaiting = trend[0]?.awaiting_count ?? null;
  const latestAwaiting = live?.awaiting ?? null;
  const awaitingDelta =
    firstAwaiting != null && latestAwaiting != null ? latestAwaiting - firstAwaiting : null;

  const onTimeDelta =
    perf?.today_pct != null && perf?.avg7_pct != null ? perf.today_pct - perf.avg7_pct : null;

  const handleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  return (
    <div ref={containerRef} className="space-y-6 bg-background p-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Warehouse Performance</h1>
          <p className="text-foreground/60">
            Live queue, throughput &amp; despatch — {format(new Date(), "EEEE, d MMMM yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Updated:{" "}
            {liveQ.dataUpdatedAt ? format(new Date(liveQ.dataUpdatedAt), "HH:mm:ss") : "--"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              liveQ.refetch();
              trendQ.refetch();
              desQ.refetch();
              perfQ.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleFullscreen}>
            <Maximize2 className="h-4 w-4 mr-2" />
            Fullscreen
          </Button>
        </div>
      </div>

      {/* Row 1 — live queue counters */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" /> New Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-foreground">{live?.newOrders ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-2">Awaiting pick list</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" /> Awaiting Picking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-warning">{live?.awaiting ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-2">
              {awaitingDelta != null ? (
                <>
                  {awaitingDelta >= 0 ? "+" : ""}
                  {awaitingDelta} since opening
                </>
              ) : (
                "On pick lists"
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> On Backorder
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-destructive">{live?.backorder ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-2">Awaiting stock</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Truck className="h-4 w-4" /> Despatched Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-success">{despatchedToday}</div>
            <p className="text-sm text-muted-foreground mt-2">Since 00:00 UK</p>
          </CardContent>
        </Card>
      </div>

      {/* Row 2 — speeds */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Gauge className="h-4 w-4" /> Avg Throughput
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">{avgPerHour}/hr</div>
            <p className="text-xs text-muted-foreground mt-2">
              Across {hoursElapsed} working hour{hoursElapsed === 1 ? "" : "s"} · target {TARGET_PER_HOUR}/hr
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Last Full Hour
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">{lastHourCount}</div>
            <div className="mt-2 h-2 w-full bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-pd-accent"
                style={{ width: `${Math.min(100, (lastHourCount / TARGET_PER_HOUR) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Despatches in the {today.getHours() - 1}:00 hour
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Truck className="h-4 w-4" /> On-Time % (≤24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-foreground">
              {perf?.today_pct != null ? `${perf.today_pct}%` : "—"}
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-xs text-muted-foreground">
                7d avg {perf?.avg7_pct != null ? `${perf.avg7_pct}%` : "—"}
              </span>
              {onTimeDelta != null && (
                <Badge
                  variant={onTimeDelta >= 0 ? "default" : "destructive"}
                  className="text-xs"
                >
                  {onTimeDelta >= 0 ? "+" : ""}
                  {onTimeDelta.toFixed(1)} pts
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3 — Queue depth trend (today) */}
      <Card>
        <CardHeader>
          <CardTitle>Queue Depth Today (hourly)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    color: "hsl(var(--foreground))",
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="Awaiting Picking"
                  stroke="hsl(var(--warning))"
                  fill="hsl(var(--warning) / 0.25)"
                />
                <Area
                  type="monotone"
                  dataKey="New"
                  stroke="hsl(var(--pd-accent))"
                  fill="hsl(var(--pd-accent) / 0.25)"
                />
                <Area
                  type="monotone"
                  dataKey="Backorder"
                  stroke="hsl(var(--destructive))"
                  fill="hsl(var(--destructive) / 0.2)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Row 4 — Despatched per hour */}
      <Card>
        <CardHeader>
          <CardTitle>Despatches by Hour</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    color: "hsl(var(--foreground))",
                  }}
                />
                <Bar dataKey="Despatched" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default WarehousePerformance;
