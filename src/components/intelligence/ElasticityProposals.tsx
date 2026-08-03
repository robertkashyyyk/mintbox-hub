import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TrendingUp, Search, ArrowRight, Info, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const num = (v: any) => (typeof v === "number" ? v : parseFloat(String(v ?? 0))) || 0;

interface Proposal {
  id: string;
  sku: string;
  brand_name: string | null;
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
type Row = Proposal & { uplift: number };

const porTone = (por: number) =>
  por >= 50 ? "text-band-good font-semibold"
  : por >= 20 ? "text-band-good"
  : por >= 10 ? "text-band-average"
  : "text-band-poor";

const CHANNELS = [
  { key: "all", label: "All channels" },
  { key: "ebay", label: "eBay" },
  { key: "amazon", label: "Amazon" },
] as const;

const TOP_N = [
  { key: "50", label: "Top 50" },
  { key: "100", label: "Top 100" },
  { key: "200", label: "Top 200" },
  { key: "all", label: "All" },
] as const;

type SortKey = "uplift" | "projected_por_pct" | "weekly_units" | "current_price" | "step_pct_effective" | "baseline_profit_wk" | "projected_profit_wk" | "sku" | "brand_name";

export function ElasticityProposals() {
  const [channel, setChannel] = useState<string>("all");
  const [brand, setBrand] = useState<string>("all");
  const [topN, setTopN] = useState<string>("100");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "uplift", dir: "desc" });

  const { data, isLoading } = useQuery({
    queryKey: ["elasticity_proposals"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("elasticity_proposals")
        .select("*")
        .eq("action", "propose_step")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Proposal[];
    },
  });

  const brands = useMemo(() => {
    const s = new Set<string>();
    (data ?? []).forEach((p) => p.brand_name && s.add(p.brand_name));
    return Array.from(s).sort();
  }, [data]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "sku" || key === "brand_name" ? "asc" : "desc" }));

  const rows = useMemo<Row[]>(() => {
    let r: Row[] = (data ?? []).map((p) => ({ ...p, uplift: num(p.projected_profit_wk) - num(p.baseline_profit_wk) }));
    if (channel !== "all") r = r.filter((p) => p.channel_group === channel);
    if (brand !== "all") r = r.filter((p) => (p.brand_name ?? "") === brand);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((p) => p.sku.toLowerCase().includes(q) || (p.brand_name ?? "").toLowerCase().includes(q));
    const { key, dir } = sort;
    const mul = dir === "asc" ? 1 : -1;
    r.sort((a, b) => {
      const av = a[key] as any, bv = b[key] as any;
      if (typeof av === "string" || typeof bv === "string")
        return String(av ?? "").localeCompare(String(bv ?? "")) * mul;
      return (num(av) - num(bv)) * mul;
    });
    return r;
  }, [data, channel, brand, search, sort]);

  const shown = topN === "all" ? rows : rows.slice(0, parseInt(topN, 10));

  const totals = useMemo(() => {
    const all = (data ?? []).map((p) => num(p.projected_profit_wk) - num(p.baseline_profit_wk));
    return {
      count: all.length,
      uplift: all.reduce((s, u) => s + u, 0),
      ebay: (data ?? []).filter((p) => p.channel_group === "ebay").length,
      amazon: (data ?? []).filter((p) => p.channel_group === "amazon").length,
      week: (data ?? [])[0] ? `${(data ?? [])[0].iso_year}-W${String((data ?? [])[0].iso_week).padStart(2, "0")}` : "—",
    };
  }, [data]);

  const SortHead = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition ${align === "right" ? "flex-row-reverse" : ""} ${sort.key === k ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
        {sort.key === k ? (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Elasticity — up-only nudges toward peak profit</AlertTitle>
        <AlertDescription>
          For profitable, in-stock, uncontested sellers moving ≥4 units/week, the engine proposes a single up-step to the
          next charm rung — bounded by a drift cap and a POR ceiling (Stellar). It <strong>proposes only</strong> for now;
          projections assume volume holds, and out-of-stock weeks are excluded. Per-line <em>Test &amp; Track</em> (pushing
          one price across all eBay stores at once) is being built next.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Proposals" value={totals.count.toLocaleString()} sub={`week ${totals.week}`} />
        <Stat label="Projected uplift / wk" value={gbp(totals.uplift)} sub="if volume holds" tone="good" />
        <Stat label="eBay" value={totals.ebay.toLocaleString()} sub="SKUs" />
        <Stat label="Amazon" value={totals.amazon.toLocaleString()} sub="SKUs" />
      </div>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-row items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">Proposed up-steps</CardTitle>
              <CardDescription>
                Click any column to sort. “Proj profit /wk” assumes units hold at the higher price — the real test is the
                Tracked tab once it&apos;s live. Showing {shown.length.toLocaleString()} of {rows.length.toLocaleString()}.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-md border overflow-hidden">
              {CHANNELS.map((c) => (
                <button key={c.key} onClick={() => setChannel(c.key)}
                  className={`px-3 py-1.5 text-xs transition ${channel === c.key ? "bg-pd-accent/15 text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}>
                  {c.label}
                </button>
              ))}
            </div>
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Brand" /></SelectTrigger>
              <SelectContent className="max-h-[320px]">
                <SelectItem value="all">All brands</SelectItem>
                {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={topN} onValueChange={setTopN}>
              <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TOP_N.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search SKU / brand…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-[180px] h-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : shown.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No proposals match this view. The proposer runs weekly (Sundays).
            </div>
          ) : (
            <div className="rounded-md border-t [&>div]:max-h-[70vh] [&>div]:overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <SortHead k="sku" label="SKU" />
                    <SortHead k="brand_name" label="Brand" />
                    <TableHead>Channel</TableHead>
                    <SortHead k="current_price" label="Current → Proposed" align="right" />
                    <SortHead k="projected_por_pct" label="Proj POR" align="right" />
                    <SortHead k="weekly_units" label="Units /wk" align="right" />
                    <SortHead k="baseline_profit_wk" label="Baseline /wk" align="right" />
                    <SortHead k="projected_profit_wk" label="Proj profit /wk" align="right" />
                    <SortHead k="uplift" label="Uplift /wk" align="right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.brand_name ?? "—"}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[11px] capitalize">{p.channel_group}</Badge></TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {gbp(p.current_price)} <ArrowRight className="inline h-3 w-3 text-muted-foreground" />{" "}
                        <span className="font-medium">{gbp(p.proposed_price)}</span>
                        <span className="ml-1 text-xs text-band-good">+{num(p.step_pct_effective)}%</span>
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${porTone(num(p.projected_por_pct))}`}>{num(p.projected_por_pct).toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{num(p.weekly_units).toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{gbp(p.baseline_profit_wk)}</TableCell>
                      <TableCell className="text-right tabular-nums">{gbp(p.projected_profit_wk)}</TableCell>
                      <TableCell className="text-right tabular-nums text-band-good font-medium">+{gbp(p.uplift)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
