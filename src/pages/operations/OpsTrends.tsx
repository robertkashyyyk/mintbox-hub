import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpsTrends, TrendRange } from "@/hooks/useOpsTrends";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { TrendingUp, Calendar, BarChart3 } from "lucide-react";

const rangeOptions: { label: string; value: TrendRange }[] = [
  { label: "7 Days", value: "7d" },
  { label: "30 Days", value: "30d" },
  { label: "90 Days", value: "90d" },
];

const OpsTrends = () => {
  const [range, setRange] = useState<TrendRange>("30d");
  const { data, isLoading } = useOpsTrends(range);

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Operations Trends</h1>
          <p className="text-sm text-muted-foreground">Loading trend data…</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      </div>
    );
  }

  const chartData = data.daily.map((d) => ({
    ...d,
    dayLabel: format(new Date(d.day), "dd MMM"),
  }));

  const rollingData = data.rolling7d.map((d) => ({
    ...d,
    dayLabel: format(new Date(d.day), "dd MMM"),
  }));

  const perf = data.periodPerformance;

  const colorFor = (pct: number) => {
    if (pct >= 90) return "text-[hsl(var(--success))]";
    if (pct >= 70) return "text-warning";
    return "text-destructive";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Operations Trends</h1>
          <p className="text-sm text-muted-foreground">
            Historical performance analysis — replaces KPI spreadsheet
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground">
            Data to: {format(new Date(), "dd MMM HH:mm")}
          </span>
          <div className="flex gap-1">
            {rangeOptions.map((opt) => (
              <Button
                key={opt.value}
                variant={range === opt.value ? "default" : "outline"}
                size="sm"
                onClick={() => setRange(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Period Performance Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Despatch Performance — {range === "7d" ? "Last 7 Days" : range === "30d" ? "Last 30 Days" : "Last 90 Days"}
            <Badge variant="secondary" className="ml-auto">
              {perf.totalDespatched} orders despatched
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <p className={`text-3xl font-bold ${colorFor(perf.pct24h)}`}>
                {perf.pct24h.toFixed(1)}%
              </p>
              <p className="text-sm text-muted-foreground">Within 24h</p>
            </div>
            <div>
              <p className={`text-3xl font-bold ${colorFor(perf.pct48h)}`}>
                {perf.pct48h.toFixed(1)}%
              </p>
              <p className="text-sm text-muted-foreground">Within 48h</p>
            </div>
            <div>
              <p className={`text-3xl font-bold ${colorFor(perf.pct72h)}`}>
                {perf.pct72h.toFixed(1)}%
              </p>
              <p className="text-sm text-muted-foreground">Within 72h</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order Flow */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Order Flow (New vs Despatched)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="dayLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="new_orders" name="New Orders" fill="hsl(var(--chart-1))" radius={[2, 2, 0, 0]} />
                <Bar dataKey="despatched" name="Despatched" fill="hsl(var(--success))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Net Flow */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Net Flow (Despatched − New)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="dayLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Bar
                  dataKey="net_flow"
                  name="Net Flow"
                  fill="hsl(var(--chart-2))"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Backorders Trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Backorders & Awaiting Picking</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="dayLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="backorders"
                  name="Backorders"
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="awaiting_picking"
                  name="Awaiting Picking"
                  stroke="hsl(41, 90%, 56%)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Rolling Averages */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">7-Day Rolling Averages</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={rollingData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="dayLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => v.toFixed(1)} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="avg_new"
                  name="Avg New"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="avg_despatched"
                  name="Avg Despatched"
                  stroke="hsl(var(--success))"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="avg_net_flow"
                  name="Avg Net Flow"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default OpsTrends;
