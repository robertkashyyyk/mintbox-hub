import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Maximize2, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format, subDays, startOfWeek, endOfWeek } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const WeeklySummary = () => {
  const { data: weeklyData, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["weekly-summary-snapshots"],
    queryFn: async () => {
      const startDate = format(subDays(new Date(), 7), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("order_status_snapshots")
        .select("*")
        .gte("capture_date_uk", startDate)
        .eq("slot", "PM")
        .order("capture_date_uk", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const chartData = weeklyData?.map((day) => ({
    date: format(new Date(day.capture_date_uk), "EEE"),
    new: day.new_count,
    picked: day.picked_count,
    backorder: day.onbackorder_count,
  })) ?? [];

  const getTrend = (current: number, previous: number) => {
    if (current > previous) return { icon: TrendingUp, color: "text-green-500", label: "Up" };
    if (current < previous) return { icon: TrendingDown, color: "text-red-500", label: "Down" };
    return { icon: Minus, color: "text-muted-foreground", label: "Flat" };
  };

  const latestDay = weeklyData?.[weeklyData.length - 1];
  const previousDay = weeklyData?.[weeklyData.length - 2];

  const summaryMetrics = latestDay && previousDay ? [
    {
      label: "New Orders",
      value: latestDay.new_count,
      trend: getTrend(latestDay.new_count, previousDay.new_count),
    },
    {
      label: "Picked",
      value: latestDay.picked_count,
      trend: getTrend(latestDay.picked_count, previousDay.picked_count),
    },
    {
      label: "Backorders",
      value: latestDay.onbackorder_count,
      trend: getTrend(previousDay.onbackorder_count, latestDay.onbackorder_count), // Inverted - lower is better
    },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Weekly Summary</h1>
          <p className="text-white/60">
            {format(startOfWeek(new Date()), "d MMM")} - {format(endOfWeek(new Date()), "d MMM yyyy")}
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

      {!isLoading && summaryMetrics.length > 0 && (
        <div className="grid gap-6 md:grid-cols-3">
          {summaryMetrics.map((metric) => (
            <Card key={metric.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {metric.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-4xl font-bold">{metric.value}</div>
                  <div className={`flex items-center gap-1 ${metric.trend.color}`}>
                    <metric.trend.icon className="h-5 w-5" />
                    <span className="text-sm">{metric.trend.label}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Daily Trends (Last 7 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              Loading chart data...
            </div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
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
                <Bar dataKey="new" name="New" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="picked" name="Picked" fill="hsl(142 76% 36%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="backorder" name="Backorder" fill="hsl(0 84% 60%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              No data available for the past week
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default WeeklySummary;
