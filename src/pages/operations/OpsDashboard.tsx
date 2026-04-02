import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpsDashboard } from "@/hooks/useOpsDashboard";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import {
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Minus,
  ShoppingCart,
  Truck,
  AlertTriangle,
  Clock,
  Activity,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Package,
  BarChart3,
  ShieldAlert,
  Timer,
  Zap,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const StatCard = ({
  title,
  value,
  icon: Icon,
  delta,
  deltaLabel,
  variant = "default",
  onClick,
}: {
  title: string;
  value: number | string;
  icon: any;
  delta?: number;
  deltaLabel?: string;
  variant?: "default" | "success" | "warning" | "danger";
  onClick?: () => void;
}) => {
  const variantStyles = {
    default: "border-border",
    success: "border-l-4 border-l-[hsl(var(--success))]",
    warning: "border-l-4 border-l-[hsl(41,90%,56%)]",
    danger: "border-l-4 border-l-destructive",
  };

  return (
    <Card
      className={`${variantStyles[variant]} ${onClick ? "cursor-pointer hover:border-primary/50 transition-all" : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold">{value}</p>
            {delta !== undefined && (
              <div className="flex items-center gap-1 text-xs">
                {delta > 0 ? (
                  <ArrowUp className="h-3 w-3 text-[hsl(41,90%,56%)]" />
                ) : delta < 0 ? (
                  <ArrowDown className="h-3 w-3 text-[hsl(var(--success))]" />
                ) : (
                  <Minus className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="text-muted-foreground">
                  {delta > 0 ? "+" : ""}
                  {delta} {deltaLabel || "today"}
                </span>
              </div>
            )}
          </div>
          <Icon className="h-8 w-8 text-muted-foreground/50" />
        </div>
      </CardContent>
    </Card>
  );
};

const FlowIndicator = ({
  label,
  value,
  isGood,
}: {
  label: string;
  value: string;
  isGood: boolean | null;
}) => (
  <div className="flex items-center justify-between py-3 border-b last:border-0">
    <span className="text-sm text-muted-foreground">{label}</span>
    <div className="flex items-center gap-2">
      <span className="font-semibold text-lg">{value}</span>
      {isGood !== null && (
        <div
          className={`h-3 w-3 rounded-full ${isGood ? "bg-[hsl(var(--success))]" : "bg-destructive"}`}
        />
      )}
    </div>
  </div>
);

const QueueBar = ({
  label,
  count,
  total,
  delta,
  color,
}: {
  label: string;
  count: number;
  total: number;
  delta: number;
  color: string;
}) => {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">{pct}%</span>
          <span className="font-semibold">{count}</span>
          {delta !== 0 && (
            <span
              className={`text-xs ${delta > 0 ? "text-[hsl(41,90%,56%)]" : "text-[hsl(var(--success))]"}`}
            >
              {delta > 0 ? "+" : ""}
              {delta}
            </span>
          )}
        </div>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

const KpiRow = ({
  label,
  todayPct,
  avg7dPct,
  mtdPct,
}: {
  label: string;
  todayPct: number;
  avg7dPct: number;
  mtdPct: number;
}) => {
  const colorFor = (pct: number, threshold24?: boolean) => {
    if (threshold24) {
      if (pct >= 90) return "text-[hsl(var(--success))] font-semibold";
      if (pct >= 70) return "text-[hsl(41,90%,56%)] font-semibold";
      return "text-destructive font-semibold";
    }
    if (pct >= 95) return "text-[hsl(var(--success))] font-semibold";
    if (pct >= 80) return "text-[hsl(41,90%,56%)] font-semibold";
    return "text-destructive font-semibold";
  };

  const is24 = label.includes("24");

  return (
    <tr className="border-b last:border-0">
      <td className="py-3 text-sm font-medium">{label}</td>
      <td className={`py-3 text-right ${colorFor(todayPct, is24)}`}>
        {todayPct.toFixed(1)}%
      </td>
      <td className={`py-3 text-right ${colorFor(avg7dPct, is24)}`}>
        {avg7dPct.toFixed(1)}%
      </td>
      <td className={`py-3 text-right ${colorFor(mtdPct, is24)}`}>
        {mtdPct.toFixed(1)}%
      </td>
    </tr>
  );
};

// Winning / Holding / Losing indicator
const OverallStatus = ({ data }: { data: any }) => {
  const clearanceRate =
    data.newOrdersToday > 0
      ? data.despatchedToday / data.newOrdersToday
      : data.despatchedToday > 0
        ? 2
        : 1;

  const backorderTrend = data.deltaBackorder;
  const problemCount = data.criticalIssues;

  let status: "winning" | "holding" | "losing";
  let statusLabel: string;
  let statusColor: string;
  let statusIcon: any;

  if (clearanceRate >= 1 && backorderTrend <= 0 && problemCount <= 2) {
    status = "winning";
    statusLabel = "Winning";
    statusColor = "bg-[hsl(var(--success))]";
    statusIcon = TrendingUp;
  } else if (clearanceRate < 0.7 || backorderTrend > 10 || problemCount > 5) {
    status = "losing";
    statusLabel = "Falling Behind";
    statusColor = "bg-destructive";
    statusIcon = TrendingDown;
  } else {
    status = "holding";
    statusLabel = "Holding";
    statusColor = "bg-[hsl(41,90%,56%)]";
    statusIcon = Minus;
  }

  const StatusIcon = statusIcon;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg ${statusColor}/10 border`}>
      <div className={`h-10 w-10 rounded-full ${statusColor} flex items-center justify-center`}>
        <StatusIcon className="h-5 w-5 text-white" />
      </div>
      <div>
        <p className="text-lg font-bold">{statusLabel}</p>
        <p className="text-xs text-muted-foreground">
          Clearance {(clearanceRate * 100).toFixed(0)}% · BO Δ{" "}
          {backorderTrend > 0 ? "+" : ""}
          {backorderTrend} · {problemCount} critical
        </p>
      </div>
    </div>
  );
};

const OpsDashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data, isLoading } = useOpsDashboard();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["ops-dashboard-live"] });
    setLastRefresh(new Date());
    setIsRefreshing(false);
  };

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Operations Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">Loading live data…</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }

  const clearanceRate =
    data.newOrdersToday > 0
      ? ((data.despatchedToday / data.newOrdersToday) * 100).toFixed(0)
      : "—";
  const clearanceIsGood =
    data.newOrdersToday > 0
      ? data.despatchedToday >= data.newOrdersToday
      : null;

  const pct = (num: number, denom: number) =>
    denom > 0 ? (num / denom) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Operations Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Are we keeping up with demand today, and where are the problems?
          </p>
        </div>
        <div className="flex items-center gap-4">
          {data.lastSyncAt && (
            <span className="text-xs text-muted-foreground">
              Last sync:{" "}
              {format(new Date(data.lastSyncAt), "dd MMM HH:mm")}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            Refreshed: {format(lastRefresh, "HH:mm:ss")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Overall Status Indicator */}
      <OverallStatus data={data} />

      {/* Section 1: Today's Reality */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Today's Reality
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            title="New Orders Today"
            value={data.newOrdersToday}
            icon={ShoppingCart}
            onClick={() => navigate("/operations/order-telemetry?status=NEW")}
          />
          <StatCard
            title="Despatched Today"
            value={data.despatchedToday}
            icon={Truck}
            variant={data.despatchedToday > 0 ? "success" : "default"}
          />
          <StatCard
            title="Current Backorders"
            value={data.currentBackorders}
            icon={AlertTriangle}
            delta={data.deltaBackorder}
            variant={data.currentBackorders > 0 ? "warning" : "default"}
            onClick={() => navigate("/operations/order-telemetry?status=ONBACKORDER")}
          />
          <StatCard
            title="Awaiting Picking"
            value={data.awaitingPicking}
            icon={Clock}
            delta={data.deltaAwaitingPicking}
            onClick={() => navigate("/operations/order-telemetry?status=AWAITINGPICKING")}
          />
          <StatCard
            title="Net Flow"
            value={
              data.netFlow > 0
                ? `+${data.netFlow}`
                : data.netFlow.toString()
            }
            icon={data.netFlow >= 0 ? TrendingUp : TrendingDown}
            variant={
              data.netFlow > 0
                ? "success"
                : data.netFlow < 0
                  ? "danger"
                  : "default"
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Flow Health */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Flow Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FlowIndicator
              label="Net Flow (Despatched − New)"
              value={
                data.netFlow > 0
                  ? `+${data.netFlow}`
                  : data.netFlow.toString()
              }
              isGood={data.netFlow >= 0}
            />
            <FlowIndicator
              label="Backorder Change Today"
              value={
                data.deltaBackorder > 0
                  ? `+${data.deltaBackorder}`
                  : data.deltaBackorder.toString()
              }
              isGood={data.deltaBackorder <= 0}
            />
            <FlowIndicator
              label="Clearance Rate"
              value={clearanceRate === "—" ? "—" : `${clearanceRate}%`}
              isGood={clearanceIsGood}
            />
          </CardContent>
        </Card>

        {/* Queue Pressure */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              Queue Pressure
              <Badge variant="secondary" className="ml-auto text-xs">
                {data.totalActive} active
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <QueueBar
              label="NEW"
              count={data.queueNew}
              total={data.totalActive}
              delta={data.deltaNew}
              color="bg-[hsl(var(--chart-1))]"
            />
            <QueueBar
              label="AWAITING PICKING"
              count={data.queueAwaitingPicking}
              total={data.totalActive}
              delta={data.deltaAwaitingPicking}
              color="bg-[hsl(41,90%,56%)]"
            />
            <QueueBar
              label="ON BACK ORDER"
              count={data.queueOnBackorder}
              total={data.totalActive}
              delta={data.deltaBackorder}
              color="bg-destructive"
            />
          </CardContent>
        </Card>

        {/* Hourly Flow */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Hourly Flow Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.hourlyFlow && data.hourlyFlow.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.hourlyFlow}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(h) => `${h}:00`}
                  />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip labelFormatter={(h) => `${h}:00`} />
                  <Legend />
                  <Bar dataKey="new_orders" name="New" fill="hsl(var(--chart-1))" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="despatched" name="Despatched" fill="hsl(var(--success))" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hourly data yet today
              </p>
            )}
          </CardContent>
        </Card>

        {/* Stage Ageing */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Timer className="h-4 w-4" />
              Stage Ageing
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.stageAgeing && data.stageAgeing.length > 0 ? (
              <div className="space-y-4">
                {data.stageAgeing.map((stage) => {
                  const formatAge = (hours: number) => {
                    if (hours < 24) return `${hours.toFixed(0)}h`;
                    return `${(hours / 24).toFixed(1)}d`;
                  };
                  const statusLabel =
                    stage.status === "NEW"
                      ? "New"
                      : stage.status === "AWAITINGPICKING"
                        ? "Awaiting Picking"
                        : "On Back Order";

                  return (
                    <div
                      key={stage.status}
                      className="flex items-center justify-between py-3 border-b last:border-0"
                    >
                      <div>
                        <p className="font-medium text-sm">{statusLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {stage.order_count} orders
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          {formatAge(stage.median_age_hours)} median
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatAge(stage.avg_age_hours)} avg
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No ageing data available
              </p>
            )}
          </CardContent>
        </Card>

        {/* Despatch Performance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Despatch Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 text-sm font-medium text-muted-foreground">
                      Metric
                    </th>
                    <th className="text-right py-2 text-sm font-medium text-muted-foreground">
                      Today
                    </th>
                    <th className="text-right py-2 text-sm font-medium text-muted-foreground">
                      7-Day Avg
                    </th>
                    <th className="text-right py-2 text-sm font-medium text-muted-foreground">
                      MTD
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <KpiRow
                    label="Within 24 hours"
                    todayPct={pct(data.despatch24h, data.totalDespatched)}
                    avg7dPct={pct(data.despatch24h7d, data.totalDespatched7d)}
                    mtdPct={pct(data.despatch24hMtd, data.totalDespatchedMtd)}
                  />
                  <KpiRow
                    label="Within 48 hours"
                    todayPct={pct(data.despatch48h, data.totalDespatched)}
                    avg7dPct={pct(data.despatch48h7d, data.totalDespatched7d)}
                    mtdPct={pct(data.despatch48hMtd, data.totalDespatchedMtd)}
                  />
                  <KpiRow
                    label="Within 72 hours"
                    todayPct={pct(data.despatch72h, data.totalDespatched)}
                    avg7dPct={pct(data.despatch72h7d, data.totalDespatched7d)}
                    mtdPct={pct(data.despatch72hMtd, data.totalDespatchedMtd)}
                  />
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Total despatched: Today {data.totalDespatched} · 7d{" "}
              {data.totalDespatched7d} · MTD {data.totalDespatchedMtd}
            </p>
          </CardContent>
        </Card>

        {/* Problem Pressure */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              Problem Pressure
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center p-3 rounded-lg bg-secondary">
                <p className="text-2xl font-bold">{data.totalProblems}</p>
                <p className="text-xs text-muted-foreground">
                  Total Problems
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-destructive/10">
                <p className="text-2xl font-bold text-destructive">
                  {data.criticalIssues}
                </p>
                <p className="text-xs text-muted-foreground">Critical</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm py-1.5 border-b">
                <span className="text-muted-foreground">New Stuck</span>
                <span className="font-medium">{data.newStuck}</span>
              </div>
              <div className="flex justify-between text-sm py-1.5 border-b">
                <span className="text-muted-foreground">
                  Repeated Snapshot
                </span>
                <span className="font-medium">{data.repeatedSnapshot}</span>
              </div>
              <div className="flex justify-between text-sm py-1.5">
                <span className="text-muted-foreground">
                  Likely Stock Issues
                </span>
                <span className="font-medium">{data.stockDiscrepancy}</span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-4"
              onClick={() => navigate("/operations/order-telemetry")}
            >
              <ExternalLink className="h-3 w-3 mr-2" />
              Open Order Telemetry
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/operations/trends")}
        >
          <TrendingUp className="h-4 w-4 mr-2" />
          View Trends
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/operations/sku-analysis")}
        >
          <Package className="h-4 w-4 mr-2" />
          SKU Analysis
        </Button>
      </div>
    </div>
  );
};

export default OpsDashboard;
