import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, subWeeks, subMonths, subQuarters, differenceInDays } from "date-fns";
import { ArrowLeft, Download, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDespatchBuckets, useDespatchChannels, type Bucket, type DespatchBucketRow } from "@/hooks/useDespatchPerformance";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type PeriodPreset =
  | "this_week" | "last_week"
  | "this_month" | "last_month"
  | "this_quarter" | "last_quarter"
  | "ytd" | "custom";

const presetLabel: Record<PeriodPreset, string> = {
  this_week: "This Week",
  last_week: "Last Week",
  this_month: "This Month",
  last_month: "Last Month",
  this_quarter: "This Quarter",
  last_quarter: "Last Quarter",
  ytd: "Year to Date",
  custom: "Custom Range",
};

const RETENTION_FLOOR = new Date("2026-01-01");

const fmtDate = (d: Date) => format(d, "yyyy-MM-dd");

const computePresetRange = (preset: PeriodPreset, today: Date = new Date()): { from: string; to: string } => {
  switch (preset) {
    case "this_week":    return { from: fmtDate(startOfWeek(today, { weekStartsOn: 1 })), to: fmtDate(endOfWeek(today, { weekStartsOn: 1 })) };
    case "last_week":    { const lw = subWeeks(today, 1); return { from: fmtDate(startOfWeek(lw, { weekStartsOn: 1 })), to: fmtDate(endOfWeek(lw, { weekStartsOn: 1 })) }; }
    case "this_month":   return { from: fmtDate(startOfMonth(today)), to: fmtDate(endOfMonth(today)) };
    case "last_month":   { const lm = subMonths(today, 1); return { from: fmtDate(startOfMonth(lm)), to: fmtDate(endOfMonth(lm)) }; }
    case "this_quarter": return { from: fmtDate(startOfQuarter(today)), to: fmtDate(endOfQuarter(today)) };
    case "last_quarter": { const lq = subQuarters(today, 1); return { from: fmtDate(startOfQuarter(lq)), to: fmtDate(endOfQuarter(lq)) }; }
    case "ytd":          return { from: fmtDate(startOfYear(today)), to: fmtDate(today) };
    default:             return { from: fmtDate(startOfMonth(today)), to: fmtDate(today) };
  }
};

const autoBucket = (from: string, to: string): Bucket => {
  const days = differenceInDays(new Date(to), new Date(from));
  if (days <= 14) return "day";
  if (days <= 90) return "week";
  if (days <= 400) return "month";
  return "quarter";
};

// Heat map: 6 colour-bands matching the user's reference scale.
const pctClass = (p: number): string => {
  if (p >= 95) return "bg-pd-accent/30 text-pd-accent-foreground"; // Great
  if (p >= 85) return "bg-success/30 text-success-foreground";     // Good
  if (p >= 70) return "bg-success/15 text-foreground";              // Average
  if (p >= 50) return "bg-warning/30 text-warning-foreground";     // Unacceptable
  if (p >= 25) return "bg-destructive/30 text-destructive-foreground"; // Poor
  return "bg-destructive/60 text-destructive-foreground";          // Terrible
};

const pct = (n: number, total: number): number => total > 0 ? (n / total) * 100 : 0;

const fmtPct = (n: number, total: number): string => total > 0 ? `${pct(n, total).toFixed(1)}%` : "—";

const fmtBucketLabel = (iso: string, bucket: Bucket): string => {
  const d = new Date(iso);
  switch (bucket) {
    case "day":     return format(d, "dd MMM yyyy");
    case "week":    return `Wk of ${format(d, "dd MMM")}`;
    case "month":   return format(d, "MMM yyyy");
    case "quarter": return `${format(d, "yyyy")} Q${Math.floor(d.getMonth() / 3) + 1}`;
  }
};

const buildCsv = (rows: DespatchBucketRow[], bucket: Bucket): string => {
  const header = ["Period","Channel","Despatched","%<6h","%<12h","%<24h","%<36h","%<48h","%<72h","%>72h","Median hrs","Mean hrs"];
  const body = rows.map(r => [
    fmtBucketLabel(r.bucket_start, bucket),
    r.channel ?? "TOTAL",
    r.total,
    fmtPct(r.under_6h, r.total),
    fmtPct(r.under_12h, r.total),
    fmtPct(r.under_24h, r.total),
    fmtPct(r.under_36h, r.total),
    fmtPct(r.under_48h, r.total),
    fmtPct(r.under_72h, r.total),
    fmtPct(r.over_72h, r.total),
    r.median_hours ?? "",
    r.mean_hours ?? "",
  ].map(v => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(","));
  return [header.join(","), ...body].join("\n");
};

const downloadCsv = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const DespatchPerformanceReport = () => {
  const navigate = useNavigate();

  const [preset, setPreset] = useState<PeriodPreset>("this_month");
  const initialRange = computePresetRange("this_month");
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);
  const [bucket, setBucket] = useState<Bucket>(autoBucket(initialRange.from, initialRange.to));
  const [bucketAuto, setBucketAuto] = useState(true);
  const [groupBy, setGroupBy] = useState<"none" | "channel">("none");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  const { data: channels } = useDespatchChannels();
  const { data: rows, isLoading } = useDespatchBuckets(
    fromDate,
    toDate,
    bucket,
    selectedChannels.length > 0 ? selectedChannels : null,
  );

  const handlePresetChange = (val: PeriodPreset) => {
    setPreset(val);
    if (val !== "custom") {
      const r = computePresetRange(val);
      setFromDate(r.from);
      setToDate(r.to);
      if (bucketAuto) setBucket(autoBucket(r.from, r.to));
    }
  };

  const handleDateChange = (kind: "from" | "to", v: string) => {
    setPreset("custom");
    if (kind === "from") setFromDate(v); else setToDate(v);
    if (bucketAuto) {
      const newRange = kind === "from" ? { from: v, to: toDate } : { from: fromDate, to: v };
      setBucket(autoBucket(newRange.from, newRange.to));
    }
  };

  const totalRows = useMemo(() => (rows ?? []).filter(r => r.channel === null), [rows]);
  const channelRows = useMemo(() => (rows ?? []).filter(r => r.channel !== null), [rows]);
  const displayRows = groupBy === "channel" ? (rows ?? []) : totalRows;

  // KPI strip — period totals (sum across all bucket totals)
  const kpi = useMemo(() => {
    const acc = totalRows.reduce(
      (a, r) => ({
        total: a.total + r.total,
        under_24h: a.under_24h + r.under_24h,
        under_48h: a.under_48h + r.under_48h,
        under_72h: a.under_72h + r.under_72h,
      }),
      { total: 0, under_24h: 0, under_48h: 0, under_72h: 0 },
    );
    return acc;
  }, [totalRows]);

  // Stacked chart data (totals only, for legibility)
  const chartData = useMemo(() => {
    return totalRows.map(r => {
      const t = r.total || 1;
      const u24 = r.under_24h;
      const u48 = r.under_48h - r.under_24h;
      const u72 = r.under_72h - r.under_48h;
      const o72 = r.over_72h;
      return {
        label: fmtBucketLabel(r.bucket_start, bucket),
        "<24h": Math.round((u24 / t) * 1000) / 10,
        "24-48h": Math.round((u48 / t) * 1000) / 10,
        "48-72h": Math.round((u72 / t) * 1000) / 10,
        ">72h": Math.round((o72 / t) * 1000) / 10,
      };
    });
  }, [totalRows, bucket]);

  const channelBadges = useMemo(() => channels ?? [], [channels]);

  const toggleChannel = (c: string) => {
    setSelectedChannels(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  };

  const handleExport = () => {
    if (!rows) return;
    const csv = buildCsv(displayRows, bucket);
    const channelTag = selectedChannels.length === 0 ? "all" : selectedChannels.length === 1 ? selectedChannels[0].replace(/\s+/g, "-") : `${selectedChannels.length}-channels`;
    downloadCsv(`despatch-performance_${fromDate}_to_${toDate}_${channelTag}_${groupBy}.csv`, csv);
  };

  const beforeRetention = new Date(fromDate) < RETENTION_FLOOR;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" className="text-pd-accent hover:text-pd-accent-light" onClick={() => navigate("/operations/reports")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Despatch Performance</h1>
          <p className="text-sm text-foreground/60">% of orders despatched within 24h / 48h / 72h, broken down by period and channel.</p>
        </div>
        <Button variant="outlineDark" onClick={handleExport} disabled={!rows || rows.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Download CSV
        </Button>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Period</Label>
              <Select value={preset} onValueChange={(v) => handlePresetChange(v as PeriodPreset)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(presetLabel).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>From</Label>
              <Input type="date" value={fromDate} onChange={(e) => handleDateChange("from", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <Input type="date" value={toDate} onChange={(e) => handleDateChange("to", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Bucket {bucketAuto && <span className="text-xs text-muted-foreground">(auto)</span>}</Label>
              <Select value={bucket} onValueChange={(v) => { setBucket(v as Bucket); setBucketAuto(false); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="quarter">Quarter</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Label className="mr-2">Channels:</Label>
            <Badge
              variant={selectedChannels.length === 0 ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setSelectedChannels([])}
            >All</Badge>
            {channelBadges.map(c => (
              <Badge
                key={c.channel}
                variant={selectedChannels.includes(c.channel) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleChannel(c.channel)}
              >
                {c.channel} <span className="ml-1 opacity-60">({c.despatched_count.toLocaleString()})</span>
              </Badge>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Label>Group by:</Label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as "none" | "channel")}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Totals only</SelectItem>
                <SelectItem value="channel">Channel breakdown</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {beforeRetention && (
            <p className="text-xs text-warning">
              Note: operational data only goes back to 1 Jan 2026. Earlier dates will be empty.
            </p>
          )}
        </CardContent>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total Despatched</p><p className="text-3xl font-bold">{kpi.total.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Within 24h</p><p className={`text-3xl font-bold ${pctClass(pct(kpi.under_24h, kpi.total)).split(" ")[1] ?? ""}`}>{fmtPct(kpi.under_24h, kpi.total)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Within 48h</p><p className={`text-3xl font-bold ${pctClass(pct(kpi.under_48h, kpi.total)).split(" ")[1] ?? ""}`}>{fmtPct(kpi.under_48h, kpi.total)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Within 72h</p><p className={`text-3xl font-bold ${pctClass(pct(kpi.under_72h, kpi.total)).split(" ")[1] ?? ""}`}>{fmtPct(kpi.under_72h, kpi.total)}</p></CardContent></Card>
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> Distribution by {bucket}</CardTitle>
          <CardDescription>Stacked % of despatched orders falling in each speed band (totals across selected channels).</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-64 w-full" /> : chartData.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">No despatched orders in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" />
                <YAxis stroke="hsl(var(--muted-foreground))" unit="%" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                <Bar dataKey="<24h"   stackId="a" fill="hsl(var(--pd-accent))" />
                <Bar dataKey="24-48h" stackId="a" fill="hsl(var(--success))" />
                <Bar dataKey="48-72h" stackId="a" fill="hsl(var(--warning))" />
                <Bar dataKey=">72h"   stackId="a" fill="hsl(var(--destructive))" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Distribution table */}
      <Card>
        <CardHeader>
          <CardTitle>Distribution table</CardTitle>
          <CardDescription>
            Cells coloured by the speed scale (Terrible &lt;25% → Great ≥95%). Median &amp; mean are calculated on the gap between order date and despatch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-64 w-full" /> : displayRows.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">No data for the chosen filters.</p>
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Despatched</TableHead>
                    <TableHead className="text-right">&lt;6h</TableHead>
                    <TableHead className="text-right">&lt;12h</TableHead>
                    <TableHead className="text-right">&lt;24h</TableHead>
                    <TableHead className="text-right">&lt;36h</TableHead>
                    <TableHead className="text-right">&lt;48h</TableHead>
                    <TableHead className="text-right">&lt;72h</TableHead>
                    <TableHead className="text-right">&gt;72h</TableHead>
                    <TableHead className="text-right">Median hrs</TableHead>
                    <TableHead className="text-right">Mean hrs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRows.map((r, i) => {
                    const isTotal = r.channel === null;
                    return (
                      <TableRow key={`${r.bucket_start}-${r.channel ?? "TOTAL"}-${i}`} className={isTotal ? "font-semibold bg-muted/40" : ""}>
                        <TableCell>{fmtBucketLabel(r.bucket_start, bucket)}</TableCell>
                        <TableCell>{r.channel ?? "TOTAL"}</TableCell>
                        <TableCell className="text-right">{r.total.toLocaleString()}</TableCell>
                        {(["under_6h","under_12h","under_24h","under_36h","under_48h","under_72h"] as const).map(k => {
                          const p = pct(r[k], r.total);
                          return <TableCell key={k} className={`text-right ${pctClass(p)}`}>{fmtPct(r[k], r.total)}</TableCell>;
                        })}
                        <TableCell className="text-right">{fmtPct(r.over_72h, r.total)}</TableCell>
                        <TableCell className="text-right">{r.median_hours?.toFixed(1) ?? "—"}</TableCell>
                        <TableCell className="text-right">{r.mean_hours?.toFixed(1) ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Despatch time = gap between <code>order_date</code> and the moment status flipped to <code>DESPATCHED</code>. Some historical orders only got their first observed change-time when our sync first saw them as already despatched, so deep history may look slow — recent data reflects real performance.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default DespatchPerformanceReport;
