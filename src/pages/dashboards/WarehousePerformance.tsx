import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Maximize2, RefreshCw, Package, Clock, CheckCircle, AlertTriangle, Truck } from "lucide-react";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useRef } from "react";

const REFRESH_MS = 60_000;

const WarehousePerformance = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  const snapshotQ = useQuery({
    queryKey: ["warehouse-dashboard-snapshot"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_status_snapshot_today")
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
  });

  const liveQ = useQuery({
    queryKey: ["warehouse-live-counts"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const [awaiting, newOrders, picked, bo] = await Promise.all([
        supabase.from("order_lines").select("mintsoft_order_id", { count: "exact", head: true }).eq("order_status", "AWAITINGPICKING"),
        supabase.from("order_lines").select("mintsoft_order_id", { count: "exact", head: true }).eq("order_status", "NEW"),
        supabase.from("order_lines").select("mintsoft_order_id", { count: "exact", head: true }).eq("order_status", "PICKED"),
        supabase.from("order_lines").select("mintsoft_order_id", { count: "exact", head: true }).eq("order_status", "ONBACKORDER"),
      ]);
      return {
        awaiting: awaiting.count ?? 0,
        newOrders: newOrders.count ?? 0,
        picked: picked.count ?? 0,
        backorder: bo.count ?? 0,
      };
    },
  });

  const perfQ = useQuery({
    queryKey: ["warehouse-despatch-perf"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_despatch_today_vs_7d" as any);
      if (error) throw error;
      return (data as any[])?.[0] ?? null;
    },
  });

  const snapshot = snapshotQ.data;
  const live = liveQ.data;
  const perf = perfQ.data as { today_pct: number | null; today_total: number; today_on_time: number; avg7_pct: number | null } | null;

  const handleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const getStatusColor = (value: number, thresholds: { good: number; warning: number }) => {
    if (value <= thresholds.good) return "text-success";
    if (value <= thresholds.warning) return "text-warning";
    return "text-destructive";
  };

  const metrics = [
    { label: "Awaiting Picking", value: live?.awaiting ?? 0, icon: Clock, thresholds: { good: 50, warning: 150 } },
    { label: "New Orders", value: live?.newOrders ?? 0, icon: Package, thresholds: { good: 100, warning: 300 } },
    { label: "Picked", value: live?.picked ?? 0, icon: CheckCircle, thresholds: { good: 999, warning: 999 } },
    { label: "On Backorder", value: live?.backorder ?? 0, icon: AlertTriangle, thresholds: { good: 50, warning: 200 } },
  ];

  const amPmData = snapshot
    ? [
        { name: "AM", AwaitingPicking: snapshot.am_awaitingpicking ?? 0, New: snapshot.am_new ?? 0, Picked: snapshot.am_picked ?? 0, Backorder: snapshot.am_onbackorder ?? 0 },
        { name: "PM", AwaitingPicking: snapshot.pm_awaitingpicking ?? 0, New: snapshot.pm_new ?? 0, Picked: snapshot.pm_picked ?? 0, Backorder: snapshot.pm_onbackorder ?? 0 },
      ]
    : [];

  const onTimeDelta = perf?.today_pct != null && perf?.avg7_pct != null ? perf.today_pct - perf.avg7_pct : null;

  return (
    <div ref={containerRef} className="space-y-6 bg-background p-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Warehouse Performance</h1>
          <p className="text-foreground/60">
            {snapshot?.date_uk ? format(new Date(snapshot.date_uk), "EEEE, d MMMM yyyy") : "Today"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Updated: {liveQ.dataUpdatedAt ? format(new Date(liveQ.dataUpdatedAt), "HH:mm:ss") : "--"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => { liveQ.refetch(); snapshotQ.refetch(); perfQ.refetch(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleFullscreen}>
            <Maximize2 className="h-4 w-4 mr-2" />
            Fullscreen
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <metric.icon className="h-4 w-4" />
                {metric.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-5xl font-bold ${getStatusColor(metric.value, metric.thresholds)}`}>{metric.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>AM vs PM Snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            {amPmData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Snapshot data loading…</div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={amPmData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                    <YAxis stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        color: "hsl(var(--foreground))",
                      }}
                    />
                    <Legend />
                    <Bar dataKey="New" fill="hsl(var(--pd-accent))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="AwaitingPicking" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Picked" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Backorder" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Despatch Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">Today on-time (≤24h)</p>
              <div className="text-5xl font-bold text-foreground">
                {perf?.today_pct != null ? `${perf.today_pct}%` : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {perf?.today_on_time ?? 0} of {perf?.today_total ?? 0} despatched
              </p>
            </div>
            <div className="border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">7-day average</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-muted-foreground">
                  {perf?.avg7_pct != null ? `${perf.avg7_pct}%` : "—"}
                </span>
                {onTimeDelta != null && (
                  <Badge variant={onTimeDelta >= 0 ? "default" : "destructive"} className="text-xs">
                    {onTimeDelta >= 0 ? "+" : ""}{onTimeDelta.toFixed(1)} pts
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default WarehousePerformance;
