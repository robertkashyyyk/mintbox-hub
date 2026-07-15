import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TrendingUp, Search, ArrowRight, Info } from "lucide-react";

const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const num = (v: any) => (typeof v === "number" ? v : parseFloat(String(v ?? 0))) || 0;

interface Proposal {
  id: string;
  sku: string;
  channel_group: string;
  iso_year: number;
  iso_week: number;
  current_price: number;
  proposed_price: number;
  step_pct_effective: number;
  projected_por_pct: number;
  projected_profit_wk: number;
  baseline_profit_wk: number;
  floor: number;
  weekly_units: number;
  action: string;
  reason: string;
}

// POR → colour, same tiers used across the pricing pages.
const porTone = (por: number) =>
  por >= 50 ? "text-band-good font-semibold" // Stellar
  : por >= 20 ? "text-band-good"             // ok / average+
  : por >= 10 ? "text-band-average"
  : "text-band-poor";

const CHANNELS = [
  { key: "all", label: "All channels" },
  { key: "ebay", label: "eBay" },
  { key: "amazon", label: "Amazon" },
] as const;

export function ElasticityProposals() {
  const [channel, setChannel] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["elasticity_proposals"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("elasticity_proposals")
        .select("*")
        .eq("action", "propose_step");
      if (error) throw error;
      return (data ?? []) as Proposal[];
    },
  });

  const rows = useMemo(() => {
    let r = (data ?? []).map((p) => ({
      ...p,
      uplift: num(p.projected_profit_wk) - num(p.baseline_profit_wk),
    }));
    if (channel !== "all") r = r.filter((p) => p.channel_group === channel);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((p) => p.sku.toLowerCase().includes(q));
    r.sort((a, b) => b.uplift - a.uplift);
    return r;
  }, [data, channel, search]);

  const totals = useMemo(() => {
    const all = (data ?? []).map((p) => num(p.projected_profit_wk) - num(p.baseline_profit_wk));
    const ebay = (data ?? []).filter((p) => p.channel_group === "ebay").length;
    const amazon = (data ?? []).filter((p) => p.channel_group === "amazon").length;
    return {
      count: all.length,
      uplift: all.reduce((s, u) => s + u, 0),
      ebay,
      amazon,
      week: (data ?? [])[0] ? `${(data ?? [])[0].iso_year}-W${String((data ?? [])[0].iso_week).padStart(2, "0")}` : "—",
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Elasticity — up-only nudges toward peak profit</AlertTitle>
        <AlertDescription>
          For profitable, in-stock, uncontested sellers moving ≥4 units/week, the engine proposes a single up-step to the
          next charm rung — bounded by a drift cap and a POR ceiling (Stellar). It <strong>proposes only</strong>:
          projections assume volume holds, so apply the ones you like via <strong>“Push &amp; Track”</strong> on the{" "}
          <a href="/decisions/threeds-reprice" className="underline">Reprice page</a>, then watch the result on{" "}
          <a href="/intelligence/velocity" className="underline">Velocity → Tracked</a>. Out-of-stock weeks are excluded and
          profit is projected on the real order-line economics model.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Proposals" value={totals.count.toLocaleString()} sub={`week ${totals.week}`} />
        <Stat label="Projected uplift / wk" value={gbp(totals.uplift)} sub="if volume holds" tone="good" />
        <Stat label="eBay" value={totals.ebay.toLocaleString()} sub="SKUs" />
        <Stat label="Amazon" value={totals.amazon.toLocaleString()} sub="SKUs" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap pb-3">
          <div>
            <CardTitle className="text-base">Proposed up-steps</CardTitle>
            <CardDescription>
              Sorted by projected weekly profit uplift. “Proj profit /wk” assumes units hold at the higher price — the
              real test is the Tracked tab once it&apos;s live.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border overflow-hidden">
              {CHANNELS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setChannel(c.key)}
                  className={`px-3 py-1.5 text-xs transition ${channel === c.key ? "bg-pd-accent/15 text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search SKU…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-[180px]" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No elasticity proposals yet — the proposer runs weekly (Sundays). Nothing to show for this view.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead className="text-right">Current → Proposed</TableHead>
                    <TableHead className="text-right">Proj POR</TableHead>
                    <TableHead className="text-right">Units /wk</TableHead>
                    <TableHead className="text-right">Baseline profit /wk</TableHead>
                    <TableHead className="text-right">Proj profit /wk</TableHead>
                    <TableHead className="text-right">Uplift /wk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 500).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[11px] capitalize">{p.channel_group}</Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {gbp(p.current_price)} <ArrowRight className="inline h-3 w-3 text-muted-foreground" />{" "}
                        <span className="font-medium">{gbp(p.proposed_price)}</span>
                        <span className="ml-1 text-xs text-band-good">+{num(p.step_pct_effective)}%</span>
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${porTone(num(p.projected_por_pct))}`}>
                        {num(p.projected_por_pct).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{num(p.weekly_units).toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{gbp(p.baseline_profit_wk)}</TableCell>
                      <TableCell className="text-right tabular-nums">{gbp(p.projected_profit_wk)}</TableCell>
                      <TableCell className="text-right tabular-nums text-band-good font-medium">+{gbp(p.uplift)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 500 && (
                <div className="p-3 text-xs text-muted-foreground text-center border-t">
                  Showing first 500 of {rows.length.toLocaleString()} — narrow with the channel filter or search.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const Stat = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" }) => (
  <div className="rounded-lg border bg-card p-3">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className={`text-xl font-bold ${tone === "good" ? "text-band-good" : "text-foreground"}`}>{value}</div>
    {sub && <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5"><TrendingUp className="h-3 w-3" />{sub}</div>}
  </div>
);
