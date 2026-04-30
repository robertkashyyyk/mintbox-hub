import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowDown, ArrowUp, Minus, Clock } from "lucide-react";
import { format } from "date-fns";

interface BackorderSnapshot {
  id: string;
  capture_date_uk: string;
  total_onbackorder: number;
  bo_rotten_30_plus: number;
  bo_serious_14_29: number;
  bo_urgent_7_13: number;
  bo_pressure_2_6: number;
  bo_fresh_0_1: number;
  created_at: string;
}

const BUCKET_CONFIG = [
  { key: 'bo_rotten_30_plus', label: 'ROTTEN', days: '30+', variant: 'destructive' as const, className: '' },
  { key: 'bo_serious_14_29', label: 'SERIOUS', days: '14-29', variant: 'default' as const, className: 'bg-orange-500 hover:bg-orange-600' },
  { key: 'bo_urgent_7_13', label: 'URGENT', days: '7-13', variant: 'default' as const, className: 'bg-amber-500 hover:bg-amber-600' },
  { key: 'bo_pressure_2_6', label: 'PRESSURE', days: '2-6', variant: 'default' as const, className: 'bg-yellow-500 hover:bg-yellow-600 text-foreground' },
  { key: 'bo_fresh_0_1', label: 'FRESH', days: '0-1', variant: 'default' as const, className: 'bg-green-500 hover:bg-green-600' },
];

function formatUKDateTime(isoString: string): string {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatUKDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

interface DeltaIndicatorProps {
  current: number;
  previous: number | undefined;
}

function DeltaIndicator({ current, previous }: DeltaIndicatorProps) {
  if (previous === undefined) return null;
  
  const delta = current - previous;
  
  if (delta === 0) {
    return (
      <span className="text-muted-foreground text-xs flex items-center gap-0.5">
        <Minus className="h-3 w-3" />
        <span>0</span>
      </span>
    );
  }
  
  // For backorders, negative delta is good (reducing backlog)
  const isPositive = delta < 0;
  
  return (
    <span className={`text-xs flex items-center gap-0.5 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
      {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      <span>{Math.abs(delta)}</span>
    </span>
  );
}

export function BackorderAgeingSnapshot() {
  // Fetch today's snapshot
  const { data: todaySnapshot, isLoading: loadingToday, error: errorToday } = useQuery({
    queryKey: ['backorder-age-snapshot-today'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('backorder_age_snapshot')
        .select('*')
        .eq('capture_date_uk', today)
        .maybeSingle();

      if (error) throw error;
      return data as BackorderSnapshot | null;
    },
  });

  // Fetch yesterday's snapshot for comparison
  const { data: yesterdaySnapshot } = useQuery({
    queryKey: ['backorder-age-snapshot-yesterday'],
    queryFn: async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('backorder_age_snapshot')
        .select('*')
        .eq('capture_date_uk', yesterdayStr)
        .maybeSingle();

      if (error) throw error;
      return data as BackorderSnapshot | null;
    },
  });

  // Fetch latest snapshot (fallback if today's doesn't exist)
  const { data: latestSnapshot, isLoading: loadingLatest } = useQuery({
    queryKey: ['backorder-age-snapshot-latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('backorder_age_snapshot')
        .select('*')
        .order('capture_date_uk', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as BackorderSnapshot | null;
    },
    enabled: !loadingToday && !todaySnapshot,
  });

  const isLoading = loadingToday || (loadingLatest && !todaySnapshot);
  const snapshot = todaySnapshot || latestSnapshot;
  const isStale = !todaySnapshot && !!latestSnapshot;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Backorder Ageing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (errorToday) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Backorder Ageing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>Failed to load backorder data</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!snapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Backorder Ageing</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            No backorder snapshots captured yet. The first snapshot will be captured during the AM window (07:25-07:35 UK time).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Backorder Ageing</CardTitle>
          {isStale && (
            <Badge variant="outline" className="text-amber-600 border-amber-600">
              Stale Data
            </Badge>
          )}
        </div>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Capture Date:</span>
            <span className="font-medium text-foreground">
              {formatUKDate(snapshot.capture_date_uk)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-3 w-3" />
            <span>Captured at:</span>
            <span className="font-medium text-foreground">
              {formatUKDateTime(snapshot.created_at)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>Total On Backorder:</span>
            <span className="font-bold text-foreground text-base">
              {snapshot.total_onbackorder}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {BUCKET_CONFIG.map((bucket) => {
            const count = snapshot[bucket.key as keyof BackorderSnapshot] as number;
            const previousCount = yesterdaySnapshot?.[bucket.key as keyof BackorderSnapshot] as number | undefined;
            
            return (
              <div 
                key={bucket.key} 
                className="flex items-center justify-between py-2 border-b last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <Badge 
                    variant={bucket.variant} 
                    className={bucket.className}
                  >
                    {bucket.label}
                  </Badge>
                  <span className="text-muted-foreground text-sm">
                    {bucket.days} days
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-lg tabular-nums">
                    {count}
                  </span>
                  <DeltaIndicator current={count} previous={previousCount} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
