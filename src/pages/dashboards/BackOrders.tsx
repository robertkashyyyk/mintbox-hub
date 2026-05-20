import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays, subMonths, subYears, startOfWeek, startOfMonth, startOfQuarter } from "date-fns";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";

type Zoom = "day" | "week" | "month" | "quarter";
type PeriodKey = "week" | "month" | "quarter" | "year" | "custom";

type Snapshot = { capture_date_uk: string; total_onbackorder: number };

const zoomLabel: Record<Zoom, string> = {
  day: "Day", week: "Week", month: "Month", quarter: "Quarter",
};

const bucketKey = (d: Date, zoom: Zoom): string => {
  if (zoom === "day") return format(d, "yyyy-MM-dd");
  if (zoom === "week") return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-'W'II");
  if (zoom === "month") return format(startOfMonth(d), "yyyy-MM");
  return format(startOfQuarter(d), "yyyy-'Q'Q");
};

const bucketStart = (d: Date, zoom: Zoom): Date => {
  if (zoom === "day") return d;
  if (zoom === "week") return startOfWeek(d, { weekStartsOn: 1 });
  if (zoom === "month") return startOfMonth(d);
  return startOfQuarter(d);
};

const periodToRange = (p: PeriodKey, custom: { from?: Date; to?: Date }) => {
  const to = new Date();
  switch (p) {
    case "week": return { from: subDays(to, 7), to };
    case "month": return { from: subMonths(to, 1), to };
    case "quarter": return { from: subMonths(to, 3), to };
    case "year": return { from: subYears(to, 1), to };
    case "custom": return { from: custom.from ?? subMonths(to, 1), to: custom.to ?? to };
  }
};

const BackOrders = () => {
  const [zoom, setZoom] = useState<Zoom>("day");
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [customFrom, setCustomFrom] = useState<Date | undefined>(subMonths(new Date(), 1));
  const [customTo, setCustomTo] = useState<Date | undefined>(new Date());

  const range = useMemo(
    () => periodToRange(period, { from: customFrom, to: customTo }),
    [period, customFrom, customTo],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["backorder-snapshots", range.from.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      const fromStr = format(range.from, "yyyy-MM-dd");
      const toStr = format(range.to, "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("backorder_age_snapshot")
        .select("capture_date_uk, total_onbackorder")
        .gte("capture_date_uk", fromStr)
        .lte("capture_date_uk", toStr)
        .order("capture_date_uk", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Snapshot[];
    },
  });

  const { buckets, projection, floor } = useMemo(() => {
    if (!data || data.length === 0) {
      return { buckets: [] as { key: string; label: string; avg: number; ts: number }[], projection: [] as any[], floor: 0 };
    }

    // Aggregate to buckets (average per bucket).
    const map = new Map<string, { sum: number; count: number; start: Date }>();
    for (const s of data) {
      const d = new Date(s.capture_date_uk + "T00:00:00");
      const key = bucketKey(d, zoom);
      const start = bucketStart(d, zoom);
      const entry = map.get(key) ?? { sum: 0, count: 0, start };
      entry.sum += Number(s.total_onbackorder) || 0;
      entry.count += 1;
      map.set(key, entry);
    }
    const buckets = Array.from(map.entries())
      .map(([key, v]) => ({
        key,
        label: key,
        avg: Math.round(v.sum / v.count),
        ts: v.start.getTime(),
      }))
      .sort((a, b) => a.ts - b.ts);

    // Floor = min historical avg.
    const floor = Math.min(...buckets.map(b => b.avg));

    // Linear regression on buckets (y = a + b*x), x = index.
    const n = buckets.length;
    let projection: { key: string; label: string; projected: number; ts: number }[] = [];
    if (n >= 2) {
      const xs = buckets.map((_, i) => i);
      const ys = buckets.map(b => b.avg);
      const meanX = xs.reduce((a, c) => a + c, 0) / n;
      const meanY = ys.reduce((a, c) => a + c, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        num += (xs[i] - meanX) * (ys[i] - meanY);
        den += (xs[i] - meanX) ** 2;
      }
      const slope = den === 0 ? 0 : num / den;
      const intercept = meanY - slope * meanX;

      // Project forward ~25% of period (min 3 buckets).
      const steps = Math.max(3, Math.round(n * 0.25));
      const lastTs = buckets[n - 1].ts;
      const stepMs =
        zoom === "day" ? 86400_000 :
        zoom === "week" ? 7 * 86400_000 :
        zoom === "month" ? 30 * 86400_000 :
        90 * 86400_000;

      // Anchor projection at the last actual point so the lines connect.
      projection.push({
        key: buckets[n - 1].key,
        label: buckets[n - 1].label,
        projected: buckets[n - 1].avg,
        ts: lastTs,
      });
      for (let i = 1; i <= steps; i++) {
        const x = n - 1 + i;
        const raw = intercept + slope * x;
        const clamped = Math.max(floor, Math.round(raw));
        const ts = lastTs + i * stepMs;
        const d = new Date(ts);
        projection.push({
          key: bucketKey(d, zoom) + "·proj",
          label: bucketKey(d, zoom),
          projected: clamped,
          ts,
        });
      }
    }
    return { buckets, projection, floor };
  }, [data, zoom]);

  // Merge actual + projection into one chart dataset keyed by ts.
  const chartData = useMemo(() => {
    const map = new Map<number, { label: string; ts: number; actual?: number; projected?: number }>();
    for (const b of buckets) map.set(b.ts, { label: b.label, ts: b.ts, actual: b.avg });
    for (const p of projection) {
      const entry = map.get(p.ts) ?? { label: p.label, ts: p.ts };
      entry.projected = p.projected;
      map.set(p.ts, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
  }, [buckets, projection]);

  const latest = buckets.length ? buckets[buckets.length - 1].avg : 0;
  const first = buckets.length ? buckets[0].avg : 0;
  const change = latest - first;

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Back Orders</h1>
          <p className="text-sm text-muted-foreground">
            Average back-order volume over time, with linear trajectory and a historical-minimum floor.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Zoom (bucket size)</Label>
              <Select value={zoom} onValueChange={(v) => setZoom(v as Zoom)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="quarter">Quarter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Period</Label>
              <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Last Week</SelectItem>
                  <SelectItem value="month">Last Month</SelectItem>
                  <SelectItem value="quarter">Last Quarter</SelectItem>
                  <SelectItem value="year">Last Year</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {period === "custom" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">From</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-40 justify-start text-left font-normal", !customFrom && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {customFrom ? format(customFrom, "PP") : "Pick date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} initialFocus className={cn("p-3 pointer-events-auto")} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-40 justify-start text-left font-normal", !customTo && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {customTo ? format(customTo, "PP") : "Pick date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={customTo} onSelect={setCustomTo} initialFocus className={cn("p-3 pointer-events-auto")} />
                    </PopoverContent>
                  </Popover>
                </div>
              </>
            )}

            <div className="ml-auto flex gap-6 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Latest avg</div>
                <div className="font-semibold text-foreground">{latest.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Change</div>
                <div className={cn("font-semibold", change > 0 ? "text-destructive" : change < 0 ? "text-pd-accent" : "text-foreground")}>
                  {change > 0 ? "+" : ""}{change.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Floor</div>
                <div className="font-semibold text-foreground">{floor.toLocaleString()}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Average Back Orders per {zoomLabel[zoom]}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Solid line = actuals. Dashed line = linear projection, clamped at floor ({floor.toLocaleString()}).
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : chartData.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <TrendingDown className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No data in selected period.
              </div>
            </div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      color: "hsl(var(--popover-foreground))",
                    }}
                  />
                  <Legend />
                  <ReferenceLine y={floor} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" label={{ value: "Floor", fill: "hsl(var(--muted-foreground))", fontSize: 11, position: "insideTopRight" }} />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="Actual avg"
                    stroke="hsl(var(--pd-accent))"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="projected"
                    name="Projection"
                    stroke="hsl(var(--warning))"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BackOrders;
