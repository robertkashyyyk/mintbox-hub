import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ModuleHeader from "@/components/ModuleHeader";
import { FileBarChart2, TrendingUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { PageLoader } from "@/components/ui/PageLoader";

const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

interface Acc { actual_units: number; actual_profit: number; cf_units: number; cf_profit: number; value: number; }
interface Payoff {
  ok: boolean; empty?: boolean; generated_at: string; repriced_skus: number; earliest_reprice: string;
  total: Acc;
  by_account: ({ account: string } & Acc)[];
  assumptions: { courier_per_unit: number; vat: number; baseline_days: number; go_live: string; note: string };
}

function RepricingPayoff() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["reprice-payoff"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("reprice-payoff", { body: {} });
      if (error) throw error;
      return data as Payoff;
    },
  });

  const { data: trend } = useQuery({
    queryKey: ["reprice-payoff-trend"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reprice_payoff_daily" as any)
        .select("snapshot_date, value, actual_profit, cf_profit").order("snapshot_date", { ascending: true }).limit(180);
      if (error) return [] as any[];
      return (data ?? []) as unknown as { snapshot_date: string; value: number; actual_profit: number; cf_profit: number }[];
    },
  });

  // Per-day value = day-over-day change in the cumulative value.
  const dailyTrend = useMemo(() => {
    const tr = trend ?? [];
    return tr.map((p, i) => ({ snapshot_date: p.snapshot_date, daily: Math.round((i === 0 ? p.value : p.value - tr[i - 1].value) * 100) / 100 }));
  }, [trend]);

  if (isLoading) return <PageLoader rows={6} columns={[160, 90, 90, 90, 90, 80]} label="Loading payoff" />;
  if (isError || !data?.ok) return <div className="py-10 text-center text-sm text-muted-foreground">Couldn't load the payoff report.</div>;
  if (data.empty) return <div className="py-10 text-center text-sm text-muted-foreground">No repriced items yet.</div>;

  const t = data.total;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {data.repriced_skus} repriced SKUs · since {new Date(data.earliest_reprice).toLocaleDateString("en-GB")} ·
          updated {new Date(data.generated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Headline cards */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Value created</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-pd-accent">{gbp(t.value)}</div>
            <div className="text-xs text-muted-foreground">profit now vs no repricer (same period)</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Since prices went live</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold ${t.actual_profit < 0 ? "text-destructive" : ""}`}>{gbp(t.actual_profit)}</div>
            <div className="text-xs text-muted-foreground">on {t.actual_units} units actually sold</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Loss avoided</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-destructive">{gbp(t.cf_profit)}</div>
            <div className="text-xs text-muted-foreground">usual {Math.round(t.cf_units)} units would've run at old prices</div></CardContent>
        </Card>
      </div>

      {/* Trend */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-pd-accent" /> Value created over time</CardTitle></CardHeader>
        <CardContent>
          {!trend || trend.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">Trend builds from tonight's first daily snapshot. (Each night logs the day's figure so you can watch it settle.)</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--pd-accent))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--pd-accent))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="snapshot_date" tickFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} fontSize={11} />
                <YAxis tickFormatter={(v) => `£${v}`} fontSize={11} width={48} />
                <Tooltip formatter={(v: number) => gbp(v)} labelFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { dateStyle: "medium" })} />
                <Area type="monotone" dataKey="value" name="Value created" stroke="hsl(var(--pd-accent))" fill="url(#vg)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-day value created */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-pd-accent" /> Value created per day</CardTitle></CardHeader>
        <CardContent>
          {dailyTrend.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">Daily bars appear once there are two or more days of history.</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dailyTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="snapshot_date" tickFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} fontSize={11} />
                <YAxis tickFormatter={(v) => `£${v}`} fontSize={11} width={48} />
                <Tooltip formatter={(v: number) => gbp(v)} labelFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { dateStyle: "medium" })} />
                <Bar dataKey="daily" name="That day">
                  {dailyTrend.map((d, i) => <Cell key={i} fill={d.daily < 0 ? "hsl(var(--destructive))" : "hsl(var(--pd-accent))"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* By account (congruent with the headline) */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-pd-accent" /> By account</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Sold (u)</TableHead><TableHead className="text-right">Profit now</TableHead>
              <TableHead className="text-right">Usual (u)</TableHead><TableHead className="text-right">Would've made</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.by_account.map((a) => (
                <TableRow key={a.account}>
                  <TableCell>{a.account}</TableCell>
                  <TableCell className="text-right">{a.actual_units}</TableCell>
                  <TableCell className={`text-right ${a.actual_profit < 0 ? "text-destructive" : ""}`}>{gbp(a.actual_profit)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{Math.round(a.cf_units)}</TableCell>
                  <TableCell className={`text-right ${a.cf_profit < 0 ? "text-destructive" : ""}`}>{gbp(a.cf_profit)}</TableCell>
                  <TableCell className="text-right font-medium text-pd-accent">{gbp(a.value)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t-2">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">{t.actual_units}</TableCell>
                <TableCell className={`text-right ${t.actual_profit < 0 ? "text-destructive" : ""}`}>{gbp(t.actual_profit)}</TableCell>
                <TableCell className="text-right">{Math.round(t.cf_units)}</TableCell>
                <TableCell className={`text-right ${t.cf_profit < 0 ? "text-destructive" : ""}`}>{gbp(t.cf_profit)}</TableCell>
                <TableCell className="text-right text-pd-accent">{gbp(t.value)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        <strong>Value created</strong> = profit on the sales we actually made since each item's price went live, minus what those products
        would have done at their old prices over the same period — using each item's <em>usual</em> pre-reprice sales rate (so an item that
        sold at a loss and now sells less still counts the avoided loss). Real eBay fee + buyer postage per sale; courier est. {gbp(data.assumptions.courier_per_unit)}/unit.
        ⚠️ Early days: a few days of actual sales vs a {data.assumptions.baseline_days}-day rate is noisy and tends to <em>overstate</em> — it
        firms up over a week or two. Direction is reliable; the precise £ isn't yet.
      </p>
    </div>
  );
}

function Placeholder({ name }: { name: string }) {
  return <div className="py-16 text-center text-sm text-muted-foreground">{name} — coming soon.</div>;
}

export default function StandingReports() {
  return (
    <div className="space-y-6">
      <ModuleHeader title="Standing Reports" description="Recurring intelligence reports — tracked over time." icon={FileBarChart2} />
      <Tabs defaultValue="payoff" className="w-full">
        <TabsList>
          <TabsTrigger value="payoff">Repricing Payoff</TabsTrigger>
          <TabsTrigger value="b">Report B</TabsTrigger>
          <TabsTrigger value="c">Report C</TabsTrigger>
        </TabsList>
        <TabsContent value="payoff" className="mt-4"><RepricingPayoff /></TabsContent>
        <TabsContent value="b" className="mt-4"><Placeholder name="Report B" /></TabsContent>
        <TabsContent value="c" className="mt-4"><Placeholder name="Report C" /></TabsContent>
      </Tabs>
    </div>
  );
}
