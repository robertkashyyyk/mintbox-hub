import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Package, Truck, AlertTriangle, Clock } from "lucide-react";
import { format, subDays } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";

type DailyRow = {
  day: string;
  new_orders: number;
  despatched: number;
  backorders: number;
  awaiting_picking: number;
};

const WeeklySummary = () => {
  const from = format(subDays(new Date(), 6), "yyyy-MM-dd");
  const to = format(new Date(), "yyyy-MM-dd");

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["weekly-ops-trend", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ops_daily_trend", {
        from_date: from,
        to_date: to,
      });
      if (error) throw error;
      return (data ?? []) as DailyRow[];
    },
  });

  const { data: perf } = useQuery({
    queryKey: ["weekly-despatch-perf", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_despatch_performance", {
        from_date: from,
        to_date: to,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const chartData = (data ?? []).map((d) => ({
    date: format(new Date(d.day), "EEE d"),
    "New": Number(d.new_orders) || 0,
    "Despatched": Number(d.despatched) || 0,
    "Backorder": Number(d.backorders) || 0,
    "Awaiting Picking": Number(d.awaiting_picking) || 0,
  }));

  // Totals across the window
  const totals = (data ?? []).reduce(
    (acc, d) => {
      acc.new += Number(d.new_orders) || 0;
      acc.despatched += Number(d.despatched) || 0;
      return acc;
    },
    { new: 0, despatched: 0 },
  );

  // Compare last full day vs prior day for trend arrows
  const days = data ?? [];
  const today = days[days.length - 1];
  const yesterday = days[days.length - 2];

  const trendIcon = (curr: number, prev: number, lowerIsBetter = false) => {
    if (curr === prev) return { Icon: Minus, cls: "text-muted-foreground" };
    const up = curr > prev;
    const good = lowerIsBetter ? !up : up;
    return {
      Icon: up ? TrendingUp : TrendingDown,
      cls: good ? "text-pd-accent" : "text-destructive",
    };
  };

  const onTimePct = perf && perf.total_despatched > 0
    ? Math.round((Number(perf.within_24h) / Number(perf.total_despatched)) * 100)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Weekly Summary</h1>
          <p className="text-foreground/60">
            {format(new Date(from), "d MMM")} – {format(new Date(to), "d MMM yyyy")} · rolling 7 days
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Updated: {dataUpdatedAt ? format(new Date(dataUpdatedAt), "HH:mm:ss") : "--"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </div>
      </div>

      {/* Headline KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" /> New (7d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totals.new.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Avg {Math.round(totals.new / Math.max(days.length, 1))} / day
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Truck className="h-4 w-4" /> Despatched (7d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totals.despatched.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Avg {Math.round(totals.despatched / Math.max(days.length, 1))} / day
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" /> On-Time ≤24h
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{onTimePct !== null ? `${onTimePct}%` : "—"}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {perf ? `${perf.within_24h}/${perf.total_despatched} orders` : "No data"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Backorders Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            {today && yesterday ? (() => {
              const t = trendIcon(Number(today.backorders), Number(yesterday.backorders), true);
              const T = t.Icon;
              return (
                <div className="flex items-center justify-between">
                  <div className="text-3xl font-bold">{Number(today.backorders).toLocaleString()}</div>
                  <T className={`h-6 w-6 ${t.cls}`} />
                </div>
              );
            })() : <div className="text-3xl font-bold">—</div>}
            <p className="text-xs text-muted-foreground mt-1">
              vs {yesterday ? Number(yesterday.backorders).toLocaleString() : "—"} yesterday
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Daily flow chart */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Order Flow (New vs Despatched)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-72 flex items-center justify-center text-muted-foreground">Loading…</div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Legend />
                <Bar dataKey="New" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Despatched" fill="hsl(var(--pd-accent))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-72 flex items-center justify-center text-muted-foreground">
              No data
            </div>
          )}
        </CardContent>
      </Card>

      {/* Queue depth chart */}
      <Card>
        <CardHeader>
          <CardTitle>Queue Depth (Awaiting Picking & Backorders)</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="Awaiting Picking" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Backorder" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-muted-foreground">No data</div>
          )}
        </CardContent>
      </Card>

      {/* Despatch performance breakdown */}
      {perf && (
        <Card>
          <CardHeader>
            <CardTitle>Despatch Performance (7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Total Despatched</div>
                <div className="text-2xl font-semibold">{Number(perf.total_despatched).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Within 24h</div>
                <div className="text-2xl font-semibold text-pd-accent">{Number(perf.within_24h).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Within 48h</div>
                <div className="text-2xl font-semibold">{Number(perf.within_48h).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Within 72h</div>
                <div className="text-2xl font-semibold">{Number(perf.within_72h).toLocaleString()}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default WeeklySummary;
