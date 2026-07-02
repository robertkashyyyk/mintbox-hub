/**
 * Clearance Standing Report — the value story of the Clearance area, tracked.
 * Sales = demand stimulus (units shifted + cash in during the window); Liquidation
 * = capital release (cash recovered, write-down accepted). Cards aggregate the
 * per-campaign rows; the trend reuses the weekly liquidation_snapshots.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tag, Flame, TrendingUp, PoundSterling } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { PageLoader } from "@/components/ui/PageLoader";

const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);

interface CampRow {
  id: string; sku: string; type: string; status: string; stage: string | null;
  discount_pct: number | null; capital: number; units: number; revenue: number;
  outcome: string | null; start_date: string; end_date: string | null;
}

export default function ClearanceReport() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["clearance-report-campaigns"],
    queryFn: async (): Promise<CampRow[]> => {
      const { data, error } = await (supabase as any).rpc("get_clearance_report_campaigns");
      if (error) throw error;
      return data as CampRow[];
    },
  });

  const { data: payoff } = useQuery({
    queryKey: ["clearance-payoff"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_clearance_payoff");
      if (error) return null;
      return (data?.[0] ?? null) as { total_units: number; total_revenue: number; total_profit: number; total_capital_cleared: number } | null;
    },
  });

  const { data: trend = [] } = useQuery({
    queryKey: ["clearance-trend"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("liquidation_snapshots").select("snapshot_date, capital_under_clearance, on_sale_capital, liquidation_capital")
        .order("snapshot_date", { ascending: true }).limit(180);
      if (error) return [] as any[];
      return (data ?? []) as { snapshot_date: string; capital_under_clearance: number; on_sale_capital: number | null; liquidation_capital: number | null }[];
    },
  });

  const m = useMemo(() => {
    const active = rows.filter(r => r.status === "active");
    const sales = rows.filter(r => r.type === "sale");
    const sum = (rs: CampRow[], f: (r: CampRow) => number) => rs.reduce((a, r) => a + (f(r) || 0), 0);
    return {
      onSaleCapital: sum(active.filter(r => r.type === "sale"), r => r.capital),
      onSaleCount: active.filter(r => r.type === "sale").length,
      liqCapital: sum(active.filter(r => r.type === "liquidation"), r => r.capital),
      liqCount: active.filter(r => r.type === "liquidation").length,
      cashRecovered: sum(rows, r => r.revenue),
      unitsShifted: sum(rows, r => r.units),
      campaignsRun: rows.filter(r => r.status === "ended" || r.status === "reverted").length,
      worked: sales.filter(r => r.outcome === "worked").length,
      noEffect: sales.filter(r => r.outcome === "no_effect").length,
    };
  }, [rows]);

  if (isLoading) return <PageLoader rows={6} columns={[120, 70, 70, 80, 80, 70]} label="Loading clearance" />;

  if (rows.length === 0) return <div className="py-10 text-center text-sm text-muted-foreground">No clearance campaigns yet — put some dead stock on Sale or Liquidation to start the story.</div>;

  return (
    <div className="space-y-4">
      {/* Headline cards — the two value stories */}
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" />On sale now</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-pd-accent">{gbp(m.onSaleCapital)}</div><div className="text-xs text-muted-foreground">{m.onSaleCount} campaign(s)</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-1.5"><Flame className="h-3.5 w-3.5" />In liquidation now</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-orange-400">{gbp(m.liqCapital)}</div><div className="text-xs text-muted-foreground">{m.liqCount} campaign(s)</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-1.5"><PoundSterling className="h-3.5 w-3.5" />Cash recovered</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-400">{gbp(m.cashRecovered)}</div><div className="text-xs text-muted-foreground">{m.unitsShifted} units shifted in-window</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Sales that worked</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{m.worked}<span className="text-sm text-muted-foreground font-normal"> / {m.noEffect} no effect</span></div><div className="text-xs text-muted-foreground">by review outcome</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Campaigns run</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{m.campaignsRun}</div><div className="text-xs text-muted-foreground">ended or reverted</div></CardContent>
        </Card>
      </div>

      {/* Realized payoff — the value the programme has actually delivered (all channels incl. Amazon, net of cost + fees) */}
      {payoff && (
        <Card className="border-pd-accent/30">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><PoundSterling className="h-4 w-4 text-pd-accent" /> Realized payoff — all channels (incl. Amazon)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-4">
              <div><div className="text-xs text-muted-foreground">Capital cleared</div><div className="text-2xl font-bold text-pd-accent">{gbp(payoff.total_capital_cleared)}</div><div className="text-[11px] text-muted-foreground">frozen stock released</div></div>
              <div><div className="text-xs text-muted-foreground">Revenue in</div><div className="text-2xl font-bold text-emerald-400">{gbp(payoff.total_revenue)}</div><div className="text-[11px] text-muted-foreground">{payoff.total_units} units shifted</div></div>
              <div><div className="text-xs text-muted-foreground">Net profit</div><div className={`text-2xl font-bold ${payoff.total_profit >= 0 ? "text-emerald-400" : "text-destructive"}`}>{gbp(payoff.total_profit)}</div><div className="text-[11px] text-muted-foreground">revenue − cost − fees</div></div>
              <div><div className="text-xs text-muted-foreground">Effective cost to free capital</div><div className="text-2xl font-bold">{payoff.total_profit < 0 ? gbp(-payoff.total_profit) : "£0"}</div><div className="text-[11px] text-muted-foreground">the write-down we accepted</div></div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trend — capital under clearance over time, split On Sale vs In Liquidation */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-pd-accent" /> Capital under clearance over time</CardTitle></CardHeader>
        <CardContent>
          {trend.length < 2 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">Builds from the weekly snapshot — the lines fill in over the coming weeks as the pile shifts. (On Sale vs In Liquidation split starts from now.)</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="snapshot_date" tickFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} fontSize={11} />
                <YAxis tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} fontSize={11} width={48} />
                <Tooltip formatter={(v: number) => gbp(v)} labelFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { dateStyle: "medium" })} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="on_sale_capital" name="On sale" stackId="c" stroke="hsl(var(--pd-accent))" fill="hsl(var(--pd-accent))" fillOpacity={0.3} strokeWidth={2} />
                <Area type="monotone" dataKey="liquidation_capital" name="In liquidation" stackId="c" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.25} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Table — campaigns by capital, with in-window performance */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Campaigns</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>SKU</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Discount</TableHead>
              <TableHead className="text-right">Capital</TableHead><TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Revenue</TableHead><TableHead>State</TableHead><TableHead>Started</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.slice(0, 100).map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell>{r.type === "sale"
                    ? <Badge variant="outline" className="text-xs"><Tag className="h-3 w-3 mr-1" />Sale</Badge>
                    : <Badge variant="outline" className="text-xs text-orange-400 border-orange-500/30"><Flame className="h-3 w-3 mr-1" />Liq</Badge>}</TableCell>
                  <TableCell className="text-right text-sm">{r.discount_pct != null ? `${r.discount_pct}%` : "—"}</TableCell>
                  <TableCell className="text-right text-sm text-orange-400">{gbp(r.capital)}</TableCell>
                  <TableCell className="text-right text-sm">{r.units}</TableCell>
                  <TableCell className="text-right text-sm text-emerald-400">{gbp(r.revenue)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.outcome ?? r.stage ?? r.status}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.start_date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        <strong>Sales</strong> create value as demand stimulus — units shifted and cash in during the sale window vs the dead-stock baseline.
        <strong> Liquidation</strong> creates value as capital release — cash recovered against stock we'd written off, accepting the discount as the cost of freeing it.
        Revenue is in-window order value (per campaign, since it started). The trend builds from the weekly snapshot. Excludes the repricer (which counts its own value separately).
      </p>
    </div>
  );
}
