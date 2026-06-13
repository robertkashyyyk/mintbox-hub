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

const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

interface Bucket { sales: number; units: number; profit_now: number; profit_old: number; uplift: number; }
interface Payoff {
  ok: boolean; empty?: boolean; generated_at: string; repriced_skus: number; earliest_reprice: string;
  total: Bucket; at_new: Bucket; pre_live: Bucket;
  by_account: { account: string; sales: number; units: number; profit_now: number; profit_old: number; uplift: number }[];
  assumptions: { courier_per_unit: number; vat: number; old_price: string };
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

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (isError || !data?.ok) return <div className="py-10 text-center text-sm text-muted-foreground">Couldn't load the payoff report.</div>;
  if (data.empty) return <div className="py-10 text-center text-sm text-muted-foreground">No repriced items in the queue yet.</div>;

  const rows: { label: string; b: Bucket; strong?: boolean }[] = [
    { label: "Sold at the new price", b: data.at_new, strong: true },
    { label: "Sold before prices went live", b: data.pre_live },
    { label: "Total", b: data.total },
  ];

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
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Recovered so far</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-pd-accent">{gbp(data.total.uplift)}</div>
            <div className="text-xs text-muted-foreground">vs if you'd never repriced</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Repriced-item sales</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data.total.sales}<span className="text-base font-normal text-muted-foreground"> sales · {data.total.units} units</span></div>
            <div className="text-xs text-muted-foreground">{data.at_new.units} sold at the new price</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Profit now vs unchanged</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{gbp(data.total.profit_now)} <span className="text-base font-normal text-muted-foreground">vs {gbp(data.total.profit_old)}</span></div>
            <div className="text-xs text-muted-foreground">across all repriced-item sales</div></CardContent>
        </Card>
      </div>

      {/* Breakdown */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-pd-accent" /> Breakdown</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead></TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">If unchanged</TableHead><TableHead className="text-right">Now</TableHead><TableHead className="text-right">Uplift</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label} className={r.strong ? "bg-pd-accent/5" : r.label === "Total" ? "font-semibold border-t-2" : ""}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-right">{r.b.sales}</TableCell>
                  <TableCell className="text-right">{r.b.units}</TableCell>
                  <TableCell className={`text-right ${r.b.profit_old < 0 ? "text-destructive" : ""}`}>{gbp(r.b.profit_old)}</TableCell>
                  <TableCell className={`text-right ${r.b.profit_now < 0 ? "text-destructive" : ""}`}>{gbp(r.b.profit_now)}</TableCell>
                  <TableCell className="text-right font-medium text-pd-accent">{gbp(r.b.uplift)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* By account */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">By account</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Account</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">If unchanged</TableHead><TableHead className="text-right">Now</TableHead><TableHead className="text-right">Uplift</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.by_account.map((a) => (
                <TableRow key={a.account}>
                  <TableCell>{a.account}</TableCell>
                  <TableCell className="text-right">{a.sales}</TableCell>
                  <TableCell className="text-right">{a.units}</TableCell>
                  <TableCell className={`text-right ${a.profit_old < 0 ? "text-destructive" : ""}`}>{gbp(a.profit_old)}</TableCell>
                  <TableCell className={`text-right ${a.profit_now < 0 ? "text-destructive" : ""}`}>{gbp(a.profit_now)}</TableCell>
                  <TableCell className="text-right font-medium text-pd-accent">{gbp(a.uplift)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Realised £ only (actual sales of repriced items vs the same sales at their old price). Real eBay fee + buyer postage per sale;
        courier estimated at {gbp(data.assumptions.courier_per_unit)}/unit; "old price" = each SKU's median sale price before its reprice.
        v1 reads the live queue — a durable reprice-events log will make this exact long-term.
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
