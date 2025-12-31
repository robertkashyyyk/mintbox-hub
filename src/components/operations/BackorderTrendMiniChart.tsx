import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

interface BackorderSnapshot {
  capture_date_uk: string;
  total_onbackorder: number;
  bo_rotten_30_plus: number;
  bo_serious_14_29: number;
}

export const BackorderTrendMiniChart = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ops-backorder-trend-7d'],
    queryFn: async () => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const { data, error } = await supabase
        .from('backorder_age_snapshot')
        .select('capture_date_uk, total_onbackorder, bo_rotten_30_plus, bo_serious_14_29')
        .gte('capture_date_uk', sevenDaysAgo.toISOString().split('T')[0])
        .order('capture_date_uk', { ascending: true });
      
      if (error) throw error;
      
      // Get one entry per day (latest)
      const dailyData = new Map<string, BackorderSnapshot>();
      (data || []).forEach((snapshot) => {
        dailyData.set(snapshot.capture_date_uk, snapshot);
      });
      
      return Array.from(dailyData.values());
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>7-Day Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>7-Day Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            Insufficient data for trend
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((d) => ({
    date: d.capture_date_uk,
    total: d.total_onbackorder,
    critical: d.bo_rotten_30_plus + d.bo_serious_14_29,
  }));

  const firstTotal = chartData[0]?.total || 0;
  const lastTotal = chartData[chartData.length - 1]?.total || 0;
  const totalChange = lastTotal - firstTotal;
  const totalChangePercent = firstTotal > 0 ? ((totalChange / firstTotal) * 100).toFixed(1) : '0';

  const firstCritical = chartData[0]?.critical || 0;
  const lastCritical = chartData[chartData.length - 1]?.critical || 0;
  const criticalChange = lastCritical - firstCritical;
  const criticalChangePercent = firstCritical > 0 ? ((criticalChange / firstCritical) * 100).toFixed(1) : '0';

  const TrendIcon = ({ change }: { change: number }) => {
    if (change > 0) return <TrendingUp className="h-4 w-4 text-red-600" />;
    if (change < 0) return <TrendingDown className="h-4 w-4 text-green-600" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>7-Day Trend Summary</CardTitle>
        <p className="text-sm text-muted-foreground">Is this a blip or a system change?</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-24">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-popover border rounded-lg p-2 shadow-lg">
                        <p className="text-sm font-medium">{payload[0]?.payload?.date}</p>
                        <p className="text-sm text-muted-foreground">
                          Total: {payload[0]?.value}
                        </p>
                        <p className="text-sm text-red-600">
                          Critical: {payload[1]?.value}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Line
                type="monotone"
                dataKey="total"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="critical"
                stroke="hsl(var(--destructive))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="text-sm text-muted-foreground">Total Backorders</div>
            <div className="flex items-center gap-2 mt-1">
              <TrendIcon change={totalChange} />
              <span className={`font-bold ${totalChange > 0 ? 'text-red-600' : totalChange < 0 ? 'text-green-600' : ''}`}>
                {totalChange > 0 ? '+' : ''}{totalChangePercent}%
              </span>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <div className="text-sm text-muted-foreground">Critical (Rotten + Serious)</div>
            <div className="flex items-center gap-2 mt-1">
              <TrendIcon change={criticalChange} />
              <span className={`font-bold ${criticalChange > 0 ? 'text-red-600' : criticalChange < 0 ? 'text-green-600' : ''}`}>
                {criticalChange > 0 ? '+' : ''}{criticalChangePercent}%
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
