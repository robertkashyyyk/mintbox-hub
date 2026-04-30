import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Maximize2, RefreshCw, Package, Clock, CheckCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

const WarehousePerformance = () => {
  const { data: snapshot, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["warehouse-dashboard-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_status_snapshot_today")
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    refetchInterval: 60000, // Auto-refresh every 60 seconds
  });

  const getStatusColor = (value: number, thresholds: { good: number; warning: number }) => {
    if (value <= thresholds.good) return "text-green-500";
    if (value <= thresholds.warning) return "text-amber-500";
    return "text-red-500";
  };

  const metrics = [
    {
      label: "Awaiting Picking",
      amValue: snapshot?.am_awaitingpicking ?? 0,
      pmValue: snapshot?.pm_awaitingpicking,
      delta: snapshot?.delta_awaitingpicking,
      icon: Clock,
      thresholds: { good: 50, warning: 150 },
    },
    {
      label: "New Orders",
      amValue: snapshot?.am_new ?? 0,
      pmValue: snapshot?.pm_new,
      delta: snapshot?.delta_new,
      icon: Package,
      thresholds: { good: 100, warning: 300 },
    },
    {
      label: "Picked",
      amValue: snapshot?.am_picked ?? 0,
      pmValue: snapshot?.pm_picked,
      delta: snapshot?.delta_picked,
      icon: CheckCircle,
      thresholds: { good: 999, warning: 999 }, // Higher is better
    },
    {
      label: "On Backorder",
      amValue: snapshot?.am_onbackorder ?? 0,
      pmValue: snapshot?.pm_onbackorder,
      delta: snapshot?.delta_onbackorder,
      icon: AlertTriangle,
      thresholds: { good: 50, warning: 200 },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Warehouse Performance</h1>
          <p className="text-foreground/60">
            {snapshot?.date_uk ? format(new Date(snapshot.date_uk), "EEEE, d MMMM yyyy") : "Today"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Updated: {dataUpdatedAt ? format(new Date(dataUpdatedAt), "HH:mm:ss") : "--"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Maximize2 className="h-4 w-4 mr-2" />
            Fullscreen
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 bg-muted rounded w-24" />
              </CardHeader>
              <CardContent>
                <div className="h-16 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <Card key={metric.label} className="relative overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <metric.icon className="h-4 w-4" />
                  {metric.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-5xl font-bold ${getStatusColor(metric.amValue, metric.thresholds)}`}>
                  {metric.pmValue ?? metric.amValue}
                </div>
                {metric.delta !== null && metric.delta !== undefined && (
                  <div className="flex items-center gap-2 mt-2 text-sm">
                    <span className="text-muted-foreground">AM: {metric.amValue}</span>
                    <Badge variant={metric.delta > 0 ? "destructive" : metric.delta < 0 ? "default" : "secondary"}>
                      {metric.delta > 0 ? "+" : ""}{metric.delta}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Today's Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>AM/PM comparison chart will appear here once both snapshots are captured</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default WarehousePerformance;
