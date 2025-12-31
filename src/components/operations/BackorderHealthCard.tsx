import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUp, ArrowDown, Minus, AlertTriangle } from "lucide-react";

interface BackorderDelta {
  capture_date_uk: string;
  total_onbackorder: number;
  bo_rotten_30_plus: number;
  bo_serious_14_29: number;
  bo_urgent_7_13: number;
  bo_pressure_2_6: number;
  bo_fresh_0_1: number;
  created_at: string;
  delta_total: number;
  delta_rotten: number;
  delta_serious: number;
  delta_urgent: number;
  delta_pressure: number;
  delta_fresh: number;
}

const BUCKETS = [
  { key: 'bo_rotten_30_plus', deltaKey: 'delta_rotten', label: 'ROTTEN', sublabel: '30+ days', color: 'bg-red-500', textColor: 'text-red-600' },
  { key: 'bo_serious_14_29', deltaKey: 'delta_serious', label: 'SERIOUS', sublabel: '14-29 days', color: 'bg-orange-500', textColor: 'text-orange-600' },
  { key: 'bo_urgent_7_13', deltaKey: 'delta_urgent', label: 'URGENT', sublabel: '7-13 days', color: 'bg-amber-500', textColor: 'text-amber-600' },
  { key: 'bo_pressure_2_6', deltaKey: 'delta_pressure', label: 'PRESSURE', sublabel: '2-6 days', color: 'bg-yellow-500', textColor: 'text-yellow-600' },
  { key: 'bo_fresh_0_1', deltaKey: 'delta_fresh', label: 'FRESH', sublabel: '0-1 days', color: 'bg-green-500', textColor: 'text-green-600' },
] as const;

const DeltaIndicator = ({ delta }: { delta: number }) => {
  if (delta > 0) {
    return (
      <span className="flex items-center text-red-600 font-medium">
        <ArrowUp className="h-4 w-4 mr-1" />
        +{delta}
      </span>
    );
  } else if (delta < 0) {
    return (
      <span className="flex items-center text-green-600 font-medium">
        <ArrowDown className="h-4 w-4 mr-1" />
        {delta}
      </span>
    );
  }
  return (
    <span className="flex items-center text-muted-foreground">
      <Minus className="h-4 w-4 mr-1" />
      0
    </span>
  );
};

export const BackorderHealthCard = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ops-backorder-delta'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ops_backorder_daily_delta')
        .select('*')
        .maybeSingle();
      
      if (error) throw error;
      return data as BackorderDelta | null;
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Backorder Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Backorder Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No backorder data available for today
          </p>
        </CardContent>
      </Card>
    );
  }

  const total = data.total_onbackorder || 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Backorder Health
          </span>
          <span className="text-2xl font-bold">{data.total_onbackorder}</span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">Legacy rot scoreboard</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {BUCKETS.map((bucket) => {
          const count = (data as any)[bucket.key] as number;
          const delta = (data as any)[bucket.deltaKey] as number;
          const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : '0';

          return (
            <div key={bucket.key} className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
              <div className={`w-3 h-12 rounded ${bucket.color}`} />
              <div className="flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`font-bold ${bucket.textColor}`}>{bucket.label}</span>
                  <span className="text-xs text-muted-foreground">{bucket.sublabel}</span>
                </div>
                <div className="text-sm text-muted-foreground">{percentage}% of total</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{count}</div>
                <DeltaIndicator delta={delta} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
