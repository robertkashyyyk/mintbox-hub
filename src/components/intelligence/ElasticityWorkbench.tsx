import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { snapPrice } from "@/lib/charmSnap";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, ArrowRight, Info, FlaskConical, Loader2, RotateCcw, TrendingUp } from "lucide-react";
import { ElasticityProposals } from "@/components/intelligence/ElasticityProposals";

const gbp = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n));
const num = (v: any) => (typeof v === "number" ? v : parseFloat(String(v ?? 0))) || 0;

// POR tiers (mirror the profit bands). Value = the tier's FLOOR POR fraction — we
// target just squeaking into the tier and let the charm snap pop it in healthy.
const TIERS = ["loss", "breakeven", "poor", "average", "good", "great", "amazing", "stellar"] as const;
type Tier = typeof TIERS[number];
const TIER_TARGET: Record<Tier, number | null> = {
  loss: null, breakeven: null, poor: 0.02, average: 0.10, good: 0.20, great: 0.25, amazing: 0.30, stellar: 0.50,
};
const tierIdx = (t: string) => TIERS.indexOf(t as Tier);
const tierTone = (t: string) =>
  t === "stellar" || t === "amazing" ? "border-band-good/50 bg-band-good/10 text-band-good"
  : t === "great" || t === "good" ? "border-band-average/50 bg-band-average/10 text-band-average"
  : t === "average" ? "text-foreground"
  : t === "poor" ? "border-band-poor/50 bg-band-poor/10 text-band-poor"
  : "border-band-loss/50 bg-band-loss/10 text-band-loss";

// Inc-VAT price to just reach a target POR, given per-unit cost/courier + fee rate.
// price_ex*(1 - 1.2*(fee+target)) = cost + courier ; retail = price_ex*1.2
function priceForTarget(costUnit: number, courierUnit: number, feeRate: number, target: number): number | null {
  const denom = 1 - 1.2 * (feeRate + target);
  if (denom <= 0) return null;
  return ((costUnit + courierUnit) / denom) * 1.2;
}

interface Seller {
  sku: string; brand_name: string | null; stores: number;
  units: number; units_per_wk: number;
  revenue_ex: number; cost_total: number; courier_total: number; fees_total: number; profit: number;
  cur_por: number; tier: string;
  avg_price_inc: number; min_price_inc: number; max_price_inc: number;
  cost_unit: number; courier_unit: number; fee_rate: number; current_stock: number | null;
}
type SortKey = "units_per_wk" | "cur_por" | "avg_price_inc" | "stores" | "sku" | "brand_name" | "current_stock";

export function ElasticityWorkbench() {
  return (
    <Tabs defaultValue="sellers" className="space-y-4">
      <TabsList>
        <TabsTrigger value="sellers">Sellers</TabsTrigger>
        <TabsTrigger value="tests">Live tests</TabsTrigger>
        <TabsTrigger value="engine">Engine picks</TabsTrigger>
      </TabsList>
      <TabsContent value="sellers"><SellersTab /></TabsContent>
      <TabsContent value="tests"><TestsTab /></TabsContent>
      <TabsContent value="engine"><ElasticityProposals /></TabsContent>
    </Tabs>
  );
}

function SellersTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [brand, setBrand] = useState("all");
  const [topN, setTopN] = useState("100");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "units_per_wk", dir: "desc" });
  const [target, setTarget] = useState<Record<string, Tier>>({}); // sku -> target tier

  const { data: sellers, isLoading } = useQuery({
    queryKey: ["elasticity_sellers"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_elasticity_sellers", { p_days: 30, p_min_units: 4 });
      if (error) throw error;
      return (data ?? []) as Seller[];
    },
  });

  const { data: ebayStores } = useQuery({
    queryKey: ["ebay-stores-enabled"],
    queryFn: async () => {
      const { data, error } = await supabase.from("threeds_stores").select("id, store_name, mintsoft_channel, enabled").eq("enabled", true);
      if (error) throw error;
      return (data ?? []).filter((s: any) => (s.mintsoft_channel ?? "").toLowerCase().startsWith("ebay"));
    },
  });

  const brands = useMemo(() => Array.from(new Set((sellers ?? []).map((s) => s.brand_name).filter(Boolean) as string[])).sort(), [sellers]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "sku" || key === "brand_name" ? "asc" : "desc" }));

  const rows = useMemo(() => {
    let r = [...(sellers ?? [])];
    if (brand !== "all") r = r.filter((s) => (s.brand_name ?? "") === brand);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((s) => s.sku.toLowerCase().includes(q) || (s.brand_name ?? "").toLowerCase().includes(q));
    const { key, dir } = sort; const mul = dir === "asc" ? 1 : -1;
    r.sort((a, b) => {
      const av = a[key] as any, bv = b[key] as any;
      if (typeof av === "string" || typeof bv === "string") return String(av ?? "").localeCompare(String(bv ?? "")) * mul;
      return (num(av) - num(bv)) * mul;
    });
    return r;
  }, [sellers, brand, search, sort]);
  const shown = topN === "all" ? rows : rows.slice(0, parseInt(topN, 10));

  // Test price for a row given its selected target tier.
  const testPriceFor = (s: Seller): { price: number | null; tier: Tier | null } => {
    const t = target[s.sku];
    if (!t) return { price: null, tier: null };
    const raw = priceForTarget(num(s.cost_unit), num(s.courier_unit), num(s.fee_rate), TIER_TARGET[t] ?? 0);
    if (raw == null) return { price: null, tier: t };
    const snapped = snapPrice(raw, "charm", 0).listPrice;
    return { price: snapped ?? raw, tier: t };
  };

  const testMutation = useMutation({
    mutationFn: async (s: Seller) => {
      const { price, tier } = testPriceFor(s);
      if (price == null || tier == null) throw new Error("Pick a target tier first");
      if (price <= s.avg_price_inc) throw new Error("Test price isn't a raise — pick a higher tier");
      const stores = ebayStores ?? [];
      if (stores.length === 0) throw new Error("No eBay stores found");
      let pushed = 0; const failures: string[] = [];
      for (const st of stores) {
        const { data, error } = await supabase.functions.invoke("threeds-reprice-push", {
          body: { store_id: st.id, source: "elasticity", rows: [{ sku: s.sku, new_price: Number(price.toFixed(2)) }] },
        });
        if (error || (data as any)?.error) failures.push(st.store_name);
        else pushed++;
      }
      if (pushed === 0) throw new Error(`Push failed on all stores: ${failures.join(", ")}`);
      const { error: insErr } = await (supabase as any).from("elasticity_tests").insert({
        sku: s.sku, brand_name: s.brand_name, target_tier: tier,
        baseline_price_inc: Number(num(s.avg_price_inc).toFixed(2)), test_price_inc: Number(price.toFixed(2)),
        stores_pushed: pushed, baseline_units_wk: num(s.units_per_wk),
        baseline_profit_wk: Math.round(num(s.profit) / (30 / 7) * 100) / 100,
      });
      if (insErr) throw new Error(insErr.message);
      return { sku: s.sku, price, pushed, failures };
    },
    onSuccess: (d) => {
      toast({ title: "Test started", description: `${d.sku} → ${gbp(d.price)} pushed to ${d.pushed} eBay store${d.pushed === 1 ? "" : "s"}${d.failures.length ? ` (failed: ${d.failures.join(", ")})` : ""}. Watch it on Live tests.` });
      qc.invalidateQueries({ queryKey: ["elasticity_tests_tracking"] });
      qc.invalidateQueries({ queryKey: ["elasticity_sellers"] });
    },
    onError: (e: Error) => toast({ title: "Couldn’t start test", description: e.message, variant: "destructive" }),
  });
  const busySku = testMutation.isPending ? (testMutation.variables as Seller)?.sku : null;

  const SortHead = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-foreground transition ${align === "right" ? "flex-row-reverse" : ""} ${sort.key === k ? "text-foreground" : "text-muted-foreground"}`}>
        {label}{sort.key === k ? (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Elasticity sellers — one price across all eBay stores</AlertTitle>
        <AlertDescription>
          Your top eBay sellers, aggregated across all {ebayStores?.length ?? 5} stores (last 30 days, ≥4 units/wk). Pick a
          target tier to test — it computes the price to just clear that tier and the charm-snapper pops it to a clean rung.
          <strong> Test &amp; Track pushes that one price to every eBay store at once</strong> (so the cheapest store can’t
          absorb the demand) and opens a live combined-velocity test.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div>
            <CardTitle className="text-base">Sellers</CardTitle>
            <CardDescription>Click a column to sort. Showing {shown.length.toLocaleString()} of {rows.length.toLocaleString()}. Current price is the blended average; the spread shows how far apart the stores are today.</CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Brand" /></SelectTrigger>
              <SelectContent className="max-h-[320px]"><SelectItem value="all">All brands</SelectItem>{brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={topN} onValueChange={setTopN}>
              <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{["50", "100", "200", "all"].map((t) => <SelectItem key={t} value={t}>{t === "all" ? "All" : `Top ${t}`}</SelectItem>)}</SelectContent>
            </Select>
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search SKU / brand…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-[180px] h-9" /></div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <Skeleton className="h-40 w-full" /> : shown.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No eBay sellers match this view.</div>
          ) : (
            <div className="rounded-md border-t [&>div]:max-h-[70vh] [&>div]:overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <SortHead k="sku" label="SKU" />
                    <SortHead k="brand_name" label="Brand" />
                    <SortHead k="units_per_wk" label="Units /wk" align="right" />
                    <SortHead k="avg_price_inc" label="Current (inc)" align="right" />
                    <SortHead k="cur_por" label="Tier" align="right" />
                    <SortHead k="current_stock" label="Stock" align="right" />
                    <TableHead>Test to tier</TableHead>
                    <TableHead className="text-right">Test price</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((s) => {
                    const { price } = testPriceFor(s);
                    const isRaise = price != null && price > s.avg_price_inc;
                    const options = TIERS.filter((t) => TIER_TARGET[t] != null && tierIdx(t) > tierIdx(s.tier));
                    return (
                      <TableRow key={s.sku}>
                        <TableCell className="font-mono text-xs">{s.sku}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.brand_name ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(s.units_per_wk).toFixed(1)}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {gbp(s.avg_price_inc)}
                          {num(s.max_price_inc) - num(s.min_price_inc) > 0.05 && (
                            <div className="text-[10px] text-muted-foreground">{s.stores} stores · {gbp(s.min_price_inc)}–{gbp(s.max_price_inc)}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={`${tierTone(s.tier)} text-[11px] capitalize`}>{s.tier} · {num(s.cur_por).toFixed(0)}%</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{s.current_stock ?? "—"}</TableCell>
                        <TableCell>
                          <Select value={target[s.sku] ?? ""} onValueChange={(v) => setTarget((t) => ({ ...t, [s.sku]: v as Tier }))}>
                            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Pick tier…" /></SelectTrigger>
                            <SelectContent>
                              {options.length === 0 ? <SelectItem value="__none" disabled>Already top tier</SelectItem>
                                : options.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {price == null ? <span className="text-muted-foreground text-xs">—</span> : (
                            <span className={isRaise ? "" : "text-band-loss"}>
                              {gbp(s.avg_price_inc)} <ArrowRight className="inline h-3 w-3 text-muted-foreground" /> <span className="font-medium">{gbp(price)}</span>
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" disabled={!isRaise || busySku === s.sku}
                            onClick={() => testMutation.mutate(s)} title="Push this price to all eBay stores and start tracking">
                            {busySku === s.sku ? <Loader2 className="h-3 w-3 animate-spin" /> : <><FlaskConical className="h-3 w-3 mr-1" /> Test &amp; Track</>}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface TestRow {
  id: string; sku: string; brand_name: string | null; target_tier: string;
  baseline_price_inc: number; test_price_inc: number; change_pct: number | null; stores_pushed: number;
  status: string; started_at: string;
  baseline_units_wk: number | null; recent_units_wk: number; units_change_pct: number | null;
  baseline_profit_wk: number | null; recent_profit_wk: number; profit_change_pct: number | null;
  complete_weeks: number; maturity: string; disrupted: boolean;
  series: { iso_week: number; units: number; avg_price: number; profit: number }[];
}

function TestsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["elasticity_tests_tracking"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_elasticity_tests", { p_include_closed: false });
      if (error) throw error;
      return (data ?? []) as TestRow[];
    },
  });

  const { data: ebayStores } = useQuery({
    queryKey: ["ebay-stores-enabled"],
    queryFn: async () => {
      const { data } = await supabase.from("threeds_stores").select("id, store_name, mintsoft_channel, enabled").eq("enabled", true);
      return (data ?? []).filter((s: any) => (s.mintsoft_channel ?? "").toLowerCase().startsWith("ebay"));
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ t, status }: { t: TestRow; status: "kept" | "reverted" }) => {
      if (status === "reverted") {
        for (const st of ebayStores ?? []) {
          await supabase.functions.invoke("threeds-reprice-push", {
            body: { store_id: st.id, source: "elasticity", rows: [{ sku: t.sku, new_price: Number(num(t.baseline_price_inc).toFixed(2)) }] },
          });
        }
      }
      const patch: Record<string, unknown> = { status };
      if (status === "reverted") patch.reverted_at = new Date().toISOString();
      const { error } = await (supabase as any).from("elasticity_tests").update(patch).eq("id", t.id);
      if (error) throw new Error(error.message);
      return { t, status };
    },
    onSuccess: ({ t, status }) => {
      toast({ title: status === "reverted" ? "Reverted" : "Kept", description: status === "reverted" ? `${t.sku} queued back to ${gbp(t.baseline_price_inc)} across all eBay stores.` : `${t.sku} kept at ${gbp(t.test_price_inc)} — stopped tracking.` });
      qc.invalidateQueries({ queryKey: ["elasticity_tests_tracking"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const busy = setStatus.isPending;
  const rows = data ?? [];

  const deltaCell = (was: number | null, now: number, pct: number | null, goodUp: boolean, money = false) => {
    if (was == null) return <span className="text-muted-foreground text-xs">—</span>;
    const good = goodUp ? (pct ?? 0) >= 0 : (pct ?? 0) >= 0;
    return (
      <span className="whitespace-nowrap tabular-nums">
        {money ? gbp(was) : was.toFixed(1)} <span className="text-muted-foreground">→</span> {money ? gbp(now) : now.toFixed(1)}
        {pct != null && <span className={`ml-1 text-xs ${good ? "text-band-good" : "text-warning"}`}>{pct >= 0 ? "+" : ""}{pct}%</span>}
      </span>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Live elasticity tests</CardTitle>
        <CardDescription>
          Combined weekly units &amp; profit across all eBay stores since each test went live. Measurement starts the first
          full week; the ⚠ flag holds off until 2 full weeks. <strong>Profit /wk</strong> is the verdict — a raise wins if
          profit holds even on fewer units. Revert queues the old price back to every store.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {isLoading ? <Skeleton className="h-40 w-full" /> : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No live tests yet — start one from the <strong>Sellers</strong> tab.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Baseline → Test</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Units /wk</TableHead>
                <TableHead className="text-right">Profit /wk</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id} className={t.disrupted ? "bg-destructive/5" : ""}>
                  <TableCell className="font-mono text-xs">{t.sku}<div className="text-[10px] text-muted-foreground">{t.brand_name}</div></TableCell>
                  <TableCell><Badge variant="outline" className="text-[11px] capitalize">{t.target_tier}</Badge></TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {gbp(t.baseline_price_inc)} <ArrowRight className="inline h-3 w-3 text-muted-foreground" /> <span className="font-medium">{gbp(t.test_price_inc)}</span>
                    {t.change_pct != null && <span className="ml-1 text-xs text-band-good">+{t.change_pct}%</span>}
                    <div className="text-[10px] text-muted-foreground">{t.stores_pushed} stores</div>
                  </TableCell>
                  <TableCell>
                    {t.disrupted ? <Badge variant="secondary" className="border-destructive/50 bg-destructive/15 text-destructive text-[11px]">⚠ disrupted</Badge>
                      : t.maturity === "settling" ? <span className="text-[11px] text-muted-foreground">settling</span>
                      : t.maturity === "early" ? <Badge variant="secondary" className="text-[11px]">wk 1 · early</Badge>
                      : <Badge variant="secondary" className="border-band-good/40 bg-band-good/10 text-band-good text-[11px]">measuring · {t.complete_weeks}w</Badge>}
                  </TableCell>
                  <TableCell className="text-right">{deltaCell(t.baseline_units_wk, t.recent_units_wk, t.units_change_pct, false)}</TableCell>
                  <TableCell className="text-right">{deltaCell(t.baseline_profit_wk, t.recent_profit_wk, t.profit_change_pct, true, true)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="mr-1" disabled={busy} onClick={() => setStatus.mutate({ t, status: "kept" })}>Keep</Button>
                    <Button size="sm" variant={t.disrupted ? "default" : "outline"} disabled={busy} onClick={() => setStatus.mutate({ t, status: "reverted" })}>
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RotateCcw className="h-3 w-3 mr-1" /> Revert</>}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
