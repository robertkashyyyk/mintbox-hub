import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowDown, ArrowUp, Clock, Minus } from "lucide-react";
import { format } from "date-fns";

interface SnapshotToday {
  date_uk: string | null;
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

interface SnapshotLatest {
  slot: string | null;
  captured_at: string | null;
  new_count: number | null;
  onbackorder_count: number | null;
  awaitingpicking_count: number | null;
  picked_count: number | null;
}

const DeltaIndicator = ({ value }: { value: number | null }) => {
  if (value === null) return <Minus className="h-4 w-4 text-muted-foreground" />;
  if (value === 0) return <span className="text-muted-foreground">0</span>;
  
  // For order counts: negative delta (fewer orders) is good (green)
  // positive delta (more orders) could be concerning (amber)
  if (value < 0) {
    return (
      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
        <ArrowDown className="h-3 w-3" />
        {Math.abs(value)}
      </span>
    );
  }
  
  return (
    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
      <ArrowUp className="h-3 w-3" />
      {value}
    </span>
  );
};

const StatRow = ({ 
  label, 
  amValue, 
  pmValue, 
  delta 
}: { 
  label: string; 
  amValue: number | null; 
  pmValue: number | null; 
  delta: number | null;
}) => (
  <div className="grid grid-cols-4 gap-4 py-2 border-b border-border/50 last:border-0">
    <span className="font-medium text-muted-foreground">{label}</span>
    <span className="text-center">{amValue ?? "—"}</span>
    <span className="text-center">{pmValue ?? "—"}</span>
    <span className="text-center"><DeltaIndicator value={delta} /></span>
  </div>
);

const SlotBadge = ({ slot, capturedAt }: { slot: string; capturedAt: string | null }) => {
  if (!capturedAt) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Clock className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  }
  
  const time = format(new Date(capturedAt), "HH:mm");
  return (
    <Badge variant="secondary">
      {slot} @ {time}
    </Badge>
  );
};

export function OrderStatusSnapshots() {
  // Query today's snapshot data
  const { data: todayData, isLoading: todayLoading, error: todayError } = useQuery({
    queryKey: ["order-status-snapshot-today"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_status_snapshot_today")
        .select("*")
        .single();
      
      if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
      return data as SnapshotToday | null;
    },
    refetchInterval: 60000, // Refetch every minute
  });

  // Query latest snapshots as fallback
  const { data: latestData, isLoading: latestLoading } = useQuery({
    queryKey: ["order-status-snapshot-latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_status_snapshot_latest")
        .select("*")
        .order("captured_at", { ascending: false })
        .limit(2);
      
      if (error) throw error;
      return data as SnapshotLatest[];
    },
    enabled: !todayData, // Only fetch if today's data is missing
  });

  const isLoading = todayLoading || latestLoading;
  const hasData = todayData || (latestData && latestData.length > 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Order Status Snapshot</CardTitle>
          <CardDescription>Loading today's order metrics...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (todayError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Order Status Snapshot</CardTitle>
          <CardDescription>Today's AM vs PM order metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>Failed to load snapshot data</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Format date for display
  const displayDate = todayData?.date_uk 
    ? format(new Date(todayData.date_uk), "EEEE, d MMMM yyyy")
    : format(new Date(), "EEEE, d MMMM yyyy");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Order Status Snapshot</CardTitle>
            <CardDescription>{displayDate}</CardDescription>
          </div>
          <div className="flex gap-2">
            <SlotBadge slot="AM" capturedAt={todayData?.am_captured_at ?? null} />
            <SlotBadge slot="PM" capturedAt={todayData?.pm_captured_at ?? null} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No snapshots captured yet today</p>
            <p className="text-sm">AM snapshot: 07:30 UK • PM snapshot: 16:30 UK</p>
          </div>
        ) : (
          <div>
            {/* Header row */}
            <div className="grid grid-cols-4 gap-4 pb-2 border-b border-border font-semibold text-sm">
              <span>Status</span>
              <span className="text-center">AM</span>
              <span className="text-center">PM</span>
              <span className="text-center">Δ Delta</span>
            </div>
            
            {/* Data rows */}
            <StatRow 
              label="New" 
              amValue={todayData?.am_new ?? null}
              pmValue={todayData?.pm_new ?? null}
              delta={todayData?.delta_new ?? null}
            />
            <StatRow 
              label="On Backorder" 
              amValue={todayData?.am_onbackorder ?? null}
              pmValue={todayData?.pm_onbackorder ?? null}
              delta={todayData?.delta_onbackorder ?? null}
            />
            <StatRow 
              label="Awaiting Picking" 
              amValue={todayData?.am_awaitingpicking ?? null}
              pmValue={todayData?.pm_awaitingpicking ?? null}
              delta={todayData?.delta_awaitingpicking ?? null}
            />
            <StatRow 
              label="Picked" 
              amValue={todayData?.am_picked ?? null}
              pmValue={todayData?.pm_picked ?? null}
              delta={todayData?.delta_picked ?? null}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
