import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUp, ArrowDown, Minus, Activity } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface OrderFlowData {
  date_uk: string;
  am_captured_at: string | null;
  am_new: number | null;
  am_onbackorder: number | null;
  am_awaitingpicking: number | null;
  am_picked: number | null;
  pm_captured_at: string | null;
  pm_new: number | null;
  pm_onbackorder: number | null;
  pm_awaitingpicking: number | null;
  pm_picked: number | null;
  delta_new: number | null;
  delta_onbackorder: number | null;
  delta_awaitingpicking: number | null;
  delta_picked: number | null;
}

const METRICS = [
  { 
    amKey: 'am_new', 
    pmKey: 'pm_new', 
    deltaKey: 'delta_new', 
    label: 'NEW', 
    interpretation: 'Demand - new orders entering the system',
    inverseGood: false 
  },
  { 
    amKey: 'am_onbackorder', 
    pmKey: 'pm_onbackorder', 
    deltaKey: 'delta_onbackorder', 
    label: 'ON BACKORDER', 
    interpretation: 'Constraint - orders waiting for stock',
    inverseGood: true 
  },
  { 
    amKey: 'am_awaitingpicking', 
    pmKey: 'pm_awaitingpicking', 
    deltaKey: 'delta_awaitingpicking', 
    label: 'AWAITING PICKING', 
    interpretation: 'Internal pressure - work queue for warehouse',
    inverseGood: true 
  },
  { 
    amKey: 'am_picked', 
    pmKey: 'pm_picked', 
    deltaKey: 'delta_picked', 
    label: 'PICKED', 
    interpretation: 'Throughput - orders processed and ready to dispatch',
    inverseGood: false 
  },
] as const;

const DeltaIndicator = ({ delta, inverseGood }: { delta: number | null; inverseGood: boolean }) => {
  if (delta === null) return <span className="text-muted-foreground">—</span>;
  
  const isGood = inverseGood ? delta < 0 : delta > 0;
  const isBad = inverseGood ? delta > 0 : delta < 0;

  if (delta > 0) {
    return (
      <span className={`flex items-center font-medium ${isGood ? 'text-green-600' : isBad ? 'text-red-600' : 'text-muted-foreground'}`}>
        <ArrowUp className="h-4 w-4 mr-1" />
        +{delta}
      </span>
    );
  } else if (delta < 0) {
    return (
      <span className={`flex items-center font-medium ${isGood ? 'text-green-600' : isBad ? 'text-red-600' : 'text-muted-foreground'}`}>
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

export const OrderFlowCard = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ops-order-flow'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_status_snapshot_today')
        .select('*')
        .maybeSingle();
      
      if (error) throw error;
      return data as OrderFlowData | null;
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Order Flow & Throughput
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Order Flow & Throughput
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No order flow data available for today
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Order Flow & Throughput
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Did we clear work today, or just move it?
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-medium">Metric</th>
                <th className="text-right py-2 font-medium">AM</th>
                <th className="text-right py-2 font-medium">PM</th>
                <th className="text-right py-2 font-medium">Delta</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((metric) => (
                <Tooltip key={metric.label}>
                  <TooltipTrigger asChild>
                    <tr className="border-b hover:bg-muted/50 cursor-help">
                      <td className="py-3 font-medium">{metric.label}</td>
                      <td className="py-3 text-right text-lg">
                        {(data as any)[metric.amKey] ?? '—'}
                      </td>
                      <td className="py-3 text-right text-lg">
                        {(data as any)[metric.pmKey] ?? '—'}
                      </td>
                      <td className="py-3 text-right">
                        <DeltaIndicator 
                          delta={(data as any)[metric.deltaKey]} 
                          inverseGood={metric.inverseGood} 
                        />
                      </td>
                    </tr>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{metric.interpretation}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};
