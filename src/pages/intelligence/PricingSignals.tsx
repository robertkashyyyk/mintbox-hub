import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TrendingUp, Send, Calculator, Search, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ---------- helpers ----------
const fmtGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }).format(n || 0);
const num = (v: any) => (typeof v === "number" ? v : parseFloat(String(v ?? 0))) || 0;

// Same band logic as ProfitDashboard
const T = { loss_max: -1, breakeven_max: 1, poor_max: 9.99, average_max: 19.99 };
type Band = "loss" | "breakeven" | "poor" | "average" | "ok";
function classifyPor(porPct: number): Band {
  if (porPct < T.loss_max) return "loss";
  if (porPct <= T.breakeven_max) return "breakeven";
  if (porPct <= T.poor_max) return "poor";
  if (porPct <= T.average_max) return "average";
  return "ok";
}

const BAND_META: Record<Band, { label: string; tone: string; sortOrder: number }> = {
  loss:      { label: "Loss",      tone: "border-band-loss/60 bg-band-loss/15 text-band-loss",           sortOrder: 0 },
  breakeven: { label: "Breakeven", tone: "border-band-breakeven/60 bg-band-breakeven/15 text-band-breakeven", sortOrder: 1 },
  poor:      { label: "Poor",      tone: "border-band-poor/60 bg-band-poor/15 text-band-poor",           sortOrder: 2 },
  average:   { label: "Average",   tone: "border-band-average/60 bg-band-average/15 text-band-average",  sortOrder: 3 },
  ok:        { label: "OK",        tone: "",                                                               sortOrder: 4 },
};

// Round to nearest .95 — e.g. 12.34 → 11.95, 12.50 → 12.95, 7.10 → 6.95
function roundTo95(price: number): number {
  if (!isFinite(price) || price <= 0) return 0;
  const floor = Math.floor(price);
  const candidates = [floor - 0.05, floor + 0.95, floor + 1.95]; // x-1+.95, x+.95, x+1+.95
  let best = candidates[0];
  let bestDist = Math.abs(price - best);
  for (const c of candidates.slice(1)) {
    const d = Math.abs(price - c);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return Math.max(0.95, Math.round(best * 100) / 100);
}

// Suggested INC-VAT retail price for target POR.
// All amounts ex-VAT unless noted. VAT rate fixed at 20% (matches view).
//   p_ex      = ex-VAT price we're solving for
//   cost      = unit cost (ex-VAT)
//   courier   = courier £ per unit (fixed, scales with shipment not price)
//   feeRate   = channel fee as a fraction of inc-VAT GMV (e.g. 0.105 for ~10.5%)
//   target    = target POR (fraction of inc-VAT GMV)
//
//   profit_per_unit = p_ex - cost - courier - p_ex*1.2*feeRate
//   POR = profit_per_unit / (p_ex * 1.2) = target
//   ⇒ p_ex (1 - 1.2*feeRate - 1.2*target) = cost + courier
//   ⇒ p_ex = (cost + courier) / (1 - 1.2*(feeRate + target))
// Displayed retail = p_ex * 1.2, rounded to nearest .95.
function suggestedRetailPrice(
  cost: number,
  courierPerUnit: number,
  feeRate: number,
  targetPor: number,
): { retailIncVat: number; exVat: number } {
  const denom = 1 - 1.2 * (feeRate + targetPor);
  if (denom <= 0) return { retailIncVat: 0, exVat: 0 };
  const exVat = (cost + courierPerUnit) / denom;
  const retailIncVat = roundTo95(exVat * 1.2);
  // Recompute the ex-VAT that the rounded retail implies, for projection
  return { retailIncVat, exVat: retailIncVat / 1.2 };
}

// ---------- previous ISO week ----------
function isoWeekOf(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}
function shiftIsoWeek(year: number, week: number, delta: number) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Mon);
  target.setUTCDate(target.getUTCDate() + (week - 1 + delta) * 7);
  return isoWeekOf(target);
}

// ---------- types ----------
interface SkuRollup {
  sku: string;
  product_name: string | null;
  channel: string | null;
  brand_id: string | null;
  qty: number;
  revenue: number;          // ex-VAT
  costTotal: number;
  courierTotal: number;
  channelFeeTotal: number;
  profitTotal: number;
  avgPrice: number;
  avgCost: number;
  avgCourier: number;
  avgFees: number;
  feeRate: number;
  currentPor: number;
  band: Band;
}

const TARGET_POR_OPTIONS = [10, 15, 20, 25, 30, 35] as const;

const PricingSignals = () => {
  const { toast } = useToast();

  // Default to PREVIOUS completed ISO week
  const initial = useMemo(() => {
    const now = new Date();
    return shiftIsoWeek(...Object.values(isoWeekOf(now)) as [number, number], -1);
  }, []);
  const [{ year, week }, setWeek] = useState(initial);
  const weekKey = `${year}-W${String(week).padStart(2, "0")}`;

  const [bandFilter, setBandFilter] = useState<"all" | Band>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [targetPor, setTargetPor] = useState<number>(20); // %
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({}); // inc-VAT

  // Pull previous-week lines (paged through 1k limit)
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["pricing-signals-week", year, week],
    queryFn: async () => {
      const pageSize = 1000;
      let from = 0;
      const all: any[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("order_line_economics")
          .select("sku, product_name, channel, qty, price, cost_each, courier_cost, channel_fee, profit, order_value, missing_cost, brand_id")
          .eq("iso_year", year)
          .eq("iso_week", week)
          .order("sku", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
        if (from > 50000) break;
      }
      return all;
    },
  });

  const { data: brands = [] } = useQuery({
    queryKey: ["pricing-signals-brands"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const brandName = (id: string | null) => brands.find((b: any) => b.id === id)?.name ?? "—";

  // Roll up to SKU level (collapse channels into one row per SKU)
  const skuRollups = useMemo<SkuRollup[]>(() => {
    const map = new Map<string, SkuRollup>();
    for (const l of lines) {
      if (!l.sku) continue;
      if (l.missing_cost) continue;            // skip lines with no cost — can't price them
      if (!l.cost_each || num(l.cost_each) <= 0) continue;
      if (!l.price || num(l.price) <= 0) continue;

      const qty = num(l.qty);
      if (qty <= 0) continue;

      const entry = map.get(l.sku) || {
        sku: l.sku,
        product_name: l.product_name,
        channel: l.channel,
        brand_id: l.brand_id ?? null,
        qty: 0,
        revenue: 0,
        costTotal: 0,
        courierTotal: 0,
        channelFeeTotal: 0,
        profitTotal: 0,
        avgPrice: 0, avgCost: 0, avgCourier: 0, avgFees: 0, feeRate: 0,
        currentPor: 0,
        band: "ok" as Band,
      };
      const lineRevenue = num(l.price) * qty;
      const lineCost = num(l.cost_each) * qty;
      const lineCourier = num(l.courier_cost);
      const lineChannelFee = num(l.channel_fee);
      entry.qty += qty;
      entry.revenue += lineRevenue;
      entry.costTotal += lineCost;
      entry.courierTotal += lineCourier;
      entry.channelFeeTotal += lineChannelFee;
      entry.profitTotal += num(l.profit);
      entry.product_name = entry.product_name || l.product_name;
      entry.channel = entry.channel || l.channel;
      map.set(l.sku, entry);
    }
    const out: SkuRollup[] = [];
    for (const e of map.values()) {
      e.avgPrice = e.revenue / e.qty;
      e.avgCost  = e.costTotal / e.qty;
      e.avgCourier = e.courierTotal / e.qty;
      e.avgFees  = (e.courierTotal + e.channelFeeTotal) / e.qty;
      const gmvIncVat = e.revenue * 1.2;
      // Effective channel fee rate vs inc-VAT GMV (scales with price).
      e.feeRate = gmvIncVat > 0 ? e.channelFeeTotal / gmvIncVat : 0;
      e.currentPor = gmvIncVat > 0 ? (e.profitTotal / gmvIncVat) * 100 : 0;
      e.band = classifyPor(e.currentPor);
      out.push(e);
    }
    return out;
  }, [lines]);

  // Counts for cards
  const counts = useMemo(() => {
    const c: Record<Band | "total", number> = { loss: 0, breakeven: 0, poor: 0, average: 0, ok: 0, total: 0 };
    for (const r of skuRollups) {
      c[r.band] += 1;
      c.total += 1;
    }
    return c;
  }, [skuRollups]);

  // Filtered SKUs — only flagged bands by default; selectable via tab
  const flaggedRows = useMemo(() => {
    let rows = skuRollups.filter((r) => r.band !== "ok");
    if (bandFilter !== "all") rows = rows.filter((r) => r.band === bandFilter);
    if (brandFilter !== "all") rows = rows.filter((r) => r.brand_id === brandFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        r.sku.toLowerCase().includes(q) ||
        (r.product_name || "").toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => BAND_META[a.band].sortOrder - BAND_META[b.band].sortOrder || a.profitTotal - b.profitTotal);
    return rows;
  }, [skuRollups, bandFilter, brandFilter, search]);

  // Effective inc-VAT price for a row: manual override > suggested
  const effectivePrice = (r: SkuRollup) => {
    const override = priceOverrides[r.sku];
    if (override && override > 0) return override;
    return suggestedRetailPrice(r.avgCost, r.avgCourier, r.feeRate, targetPor / 100).retailIncVat;
  };

  // Projected impact at the target POR (uses overrides where set)
  const projection = useMemo(() => {
    let currentProfit = 0;
    let projectedProfit = 0;
    let affectedSkus = 0;
    let unfeasible = 0;

    for (const r of flaggedRows) {
      currentProfit += r.profitTotal;
      const retailIncVat = effectivePrice(r);
      if (retailIncVat <= 0) {
        projectedProfit += r.profitTotal;
        unfeasible += 1;
        continue;
      }
      const exVat = retailIncVat / 1.2;
      const newChannelFeePerUnit = exVat * 1.2 * r.feeRate;
      const newProfitPerUnit = exVat - r.avgCost - r.avgCourier - newChannelFeePerUnit;
      projectedProfit += newProfitPerUnit * r.qty;
      affectedSkus += 1;
    }
    return { currentProfit, projectedProfit, delta: projectedProfit - currentProfit, affectedSkus, unfeasible };
  }, [flaggedRows, targetPor, priceOverrides]);

  const allSelected = flaggedRows.length > 0 && flaggedRows.every((r) => selected[r.sku]);
  const toggleAll = () => {
    if (allSelected) setSelected({});
    else {
      const next: Record<string, boolean> = {};
      flaggedRows.forEach((r) => (next[r.sku] = true));
      setSelected(next);
    }
  };
  const selectedRows = flaggedRows.filter((r) => selected[r.sku]);

  const sendTo3D = () => {
    toast({
      title: "Send to 3D — placeholder",
      description: `${selectedRows.length} SKU price update${selectedRows.length === 1 ? "" : "s"} ready. API hook will be wired once 3D credentials are provided.`,
    });
    // TODO: invoke edge function with { items: selectedRows.map(r => ({ sku, new_price: suggestedPrice(...) })) }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-pd-accent" />
            Pricing Signals
          </h1>
          <p className="text-sm text-foreground/60 mt-1">
            Repricing tools driven by last week's profit data.
          </p>
        </div>
      </div>

      <Tabs defaultValue="loss-changes" className="w-full">
        <TabsList>
          <TabsTrigger value="loss-changes">Loss Changes</TabsTrigger>
          <TabsTrigger value="competitive">Competitive</TabsTrigger>
          <TabsTrigger value="elasticity">Elasticity</TabsTrigger>
          <TabsTrigger value="dynamic">Dynamic</TabsTrigger>
        </TabsList>

        <TabsContent value="loss-changes" className="space-y-5 mt-4">
          {/* Week selector */}
          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setWeek(shiftIsoWeek(year, week, -1))}>
                  ‹ Previous week
                </Button>
                <div className="text-sm">
                  <span className="font-semibold text-foreground">{weekKey}</span>
                  <span className="text-muted-foreground ml-2">(showing previous completed week by default)</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setWeek(shiftIsoWeek(year, week, 1))}>
                  Next week ›
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setWeek(initial)}>
                Reset to last week
              </Button>
            </CardContent>
          </Card>

          {/* Band cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {(["loss","breakeven","poor","average"] as Band[]).map((b) => (
              <button
                key={b}
                onClick={() => setBandFilter((cur) => cur === b ? "all" : b)}
                className={`rounded-lg border p-3 text-left transition hover:opacity-90 ${BAND_META[b].tone} ${bandFilter === b ? "ring-2 ring-pd-accent" : ""}`}
              >
                <div className="text-xs uppercase tracking-wider opacity-80">{BAND_META[b].label}</div>
                <div className="text-2xl font-bold">{counts[b].toLocaleString()}</div>
                <div className="text-xs opacity-70">SKUs to reprice</div>
              </button>
            ))}
            <button
              onClick={() => setBandFilter("all")}
              className={`rounded-lg border p-3 text-left transition hover:opacity-90 ${bandFilter === "all" ? "ring-2 ring-pd-accent" : ""}`}
            >
              <div className="text-xs uppercase tracking-wider text-muted-foreground">All flagged</div>
              <div className="text-2xl font-bold">
                {(counts.loss + counts.breakeven + counts.poor + counts.average).toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">Click any card to filter</div>
            </button>
          </div>

          {/* Controls + search + target POR */}
          <Card>
            <CardContent className="p-4 grid gap-3 md:grid-cols-[1fr_auto_auto_auto] items-end">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search SKU or product name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Brand</span>
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[320px]">
                    <SelectItem value="all">All brands</SelectItem>
                    {brands.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Target POR %</span>
                <Select value={String(targetPor)} onValueChange={(v) => setTargetPor(Number(v))}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TARGET_POR_OPTIONS.map((p) => (
                      <SelectItem key={p} value={String(p)}>{p}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Rounding</span>
                <Badge variant="outline" className="h-9 px-3 flex items-center">.95 endings</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Projection / report */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calculator className="h-4 w-4 text-pd-accent" />
                Projected impact (period {weekKey}, target {targetPor}% POR)
              </CardTitle>
              <CardDescription>
                Applies suggested .95-ending prices across <strong>all currently filtered SKUs</strong>, holding last week's units sold constant.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Stat label="Current profit" value={fmtGBP(projection.currentProfit)}
                  tone={projection.currentProfit < 0 ? "destructive" : "muted"} />
                <Stat label="Projected profit" value={fmtGBP(projection.projectedProfit)}
                  tone={projection.projectedProfit > projection.currentProfit ? "good" : "muted"} />
                <Stat label="Delta" value={`${projection.delta >= 0 ? "+" : ""}${fmtGBP(projection.delta)}`}
                  tone={projection.delta >= 0 ? "good" : "destructive"} />
                <Stat label="SKUs in scope" value={`${projection.affectedSkus.toLocaleString()}${projection.unfeasible ? ` (${projection.unfeasible} unreachable)` : ""}`} />
              </div>
            </CardContent>
          </Card>

          {/* Table + Send to 3D */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base">SKUs flagged for repricing</CardTitle>
                <CardDescription>
                  Tick rows then push them as a batch. New price = (cost + fees) ÷ (1 − POR × 1.2), rounded to nearest .95.
                </CardDescription>
              </div>
              <div className="flex items-center gap-3">
                {selectedRows.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {selectedRows.length} selected
                  </span>
                )}
                <Button
                  disabled={selectedRows.length === 0}
                  onClick={sendTo3D}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Send to 3D
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {selectedRows.length > 0 && (
                <div className="px-4 pb-3">
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Placeholder action</AlertTitle>
                    <AlertDescription>
                      The 3D push endpoint isn't wired yet. Selected items will be staged once API credentials are added.
                    </AlertDescription>
                  </Alert>
                </div>
              )}

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleAll}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Band</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Avg price (ex-VAT)</TableHead>
                      <TableHead className="text-right">Avg cost</TableHead>
                      <TableHead className="text-right">Courier / unit</TableHead>
                      <TableHead className="text-right">Channel fee %</TableHead>
                      <TableHead className="text-right">Current POR</TableHead>
                      <TableHead className="text-right">New price (inc-VAT)</TableHead>
                      <TableHead className="text-right">Δ vs current</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                    ) : flaggedRows.length === 0 ? (
                      <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">No flagged SKUs in this view.</TableCell></TableRow>
                    ) : (
                      flaggedRows.slice(0, 500).map((r) => {
                        const suggested = suggestedRetailPrice(r.avgCost, r.avgCourier, r.feeRate, targetPor / 100).retailIncVat;
                        const override = priceOverrides[r.sku];
                        const newPrice = override && override > 0 ? override : suggested;
                        const currentRetailIncVat = r.avgPrice * 1.2;
                        const delta = newPrice - currentRetailIncVat;
                        const reachable = newPrice > 0;
                        const isOverride = !!(override && override > 0);
                        return (
                          <TableRow key={r.sku}>
                            <TableCell>
                              <Checkbox
                                checked={!!selected[r.sku]}
                                onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.sku]: !!v }))}
                                disabled={!reachable}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                            <TableCell className="max-w-xs truncate">{r.product_name || "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{brandName(r.brand_id)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={BAND_META[r.band].tone}>
                                {BAND_META[r.band].label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{r.qty.toLocaleString()}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtGBP(r.avgPrice)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtGBP(r.avgCost)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtGBP(r.avgCourier)}</TableCell>
                            <TableCell className="text-right tabular-nums">{(r.feeRate * 100).toFixed(1)}%</TableCell>
                            <TableCell className="text-right tabular-nums">{r.currentPor.toFixed(1)}%</TableCell>
                            <TableCell className="text-right tabular-nums">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-muted-foreground text-xs">£</span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={isOverride ? override : (suggested > 0 ? suggested.toFixed(2) : "")}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    setPriceOverrides((p) => {
                                      const next = { ...p };
                                      if (!isFinite(v) || v <= 0) delete next[r.sku];
                                      else next[r.sku] = v;
                                      return next;
                                    });
                                  }}
                                  className={`h-8 w-24 text-right tabular-nums ${isOverride ? "border-pd-accent" : ""}`}
                                  placeholder={suggested > 0 ? suggested.toFixed(2) : "—"}
                                />
                                {isOverride && (
                                  <button
                                    type="button"
                                    onClick={() => setPriceOverrides((p) => { const n = { ...p }; delete n[r.sku]; return n; })}
                                    className="text-xs text-muted-foreground hover:text-foreground"
                                    title="Reset to suggested"
                                  >×</button>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className={`text-right tabular-nums ${delta >= 0 ? "text-band-good" : "text-band-loss"}`}>
                              {reachable ? `${delta >= 0 ? "+" : ""}${fmtGBP(delta)}` : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                {flaggedRows.length > 500 && (
                  <div className="p-3 text-xs text-muted-foreground text-center border-t">
                    Showing first 500 of {flaggedRows.length.toLocaleString()} — narrow with the band filter or search.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="competitive" className="mt-4">
          <PlaceholderArea
            title="Competitive"
            blurb="Benchmark our prices against eBay/marketplace data captured by Price Hunter — surface SKUs where we're materially above or below the field, with one-click reprice suggestions."
          />
        </TabsContent>

        <TabsContent value="elasticity" className="mt-4">
          <PlaceholderArea
            title="Elasticity"
            blurb="Estimate price sensitivity per SKU from historical price/volume movements. Suggest the price point that maximises projected weekly profit, not just margin."
          />
        </TabsContent>

        <TabsContent value="dynamic" className="mt-4">
          <PlaceholderArea
            title="Dynamic"
            blurb="Rules-based auto-repricing: time-of-day, stock cover, age, and competitive position triggers pushed continuously to 3D."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: "good" | "destructive" | "muted" }) => {
  const cls = tone === "good" ? "text-band-good" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold ${cls}`}>{value}</div>
    </div>
  );
};

export default PricingSignals;
