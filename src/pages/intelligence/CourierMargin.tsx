/**
 * Courier Margin — finds SKUs where the courier fee eats too much of the sale
 * price (especially DHL), making profit hard or impossible.
 *
 * For each flagged SKU it auto-suggests whether the item GENUINELY needs the
 * courier (dims/weight exceed the Parcel limit) or is likely MIS-ROUTED (fits
 * within Parcel — change the courier). A human confirms the verdict per SKU.
 *
 * Data: actual per-order courier cost from order_line_economics; dims from
 * products_cache; Parcel limits from carrier_format_services.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Truck, PoundSterling, AlertTriangle, Check, ArrowDownUp, Ruler } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { PageLoader } from "@/components/ui/PageLoader";

interface Candidate {
  sku: string;
  product_name: string | null;
  brand_name: string | null;
  orders: number;
  single_item_orders: number;
  avg_price: number;
  avg_courier: number;
  courier_pct: number;
  avg_margin: number | null;
  avg_por_pct: number | null;
  length_cm: number | null;
  depth_cm: number | null;
  height_cm: number | null;
  weight_g: number | null;
  review_verdict: string | null;
  review_note: string | null;
}

interface FormatService {
  slug: string; name: string;
  max_length_mm: number | null; max_width_mm: number | null;
  max_height_mm: number | null; max_weight_g: number | null;
}

type FitVerdict = "fits_parcel" | "needs_dhl" | "unknown";

// Sort-and-compare 3-D fit test (avoids guessing which axis is which).
function parcelFit(c: Candidate, parcel: FormatService | undefined): FitVerdict {
  if (!parcel) return "unknown";
  const dims = [c.length_cm, c.depth_cm, c.height_cm];
  if (dims.some(d => d == null || d <= 0)) {
    // No usable dims — but weight alone can still force a verdict
    if (c.weight_g != null && parcel.max_weight_g != null && c.weight_g > parcel.max_weight_g) return "needs_dhl";
    return "unknown";
  }
  const itemMm = (dims as number[]).map(d => d * 10).sort((a, b) => b - a);
  const limMm = [parcel.max_length_mm, parcel.max_width_mm, parcel.max_height_mm]
    .map(v => v ?? Infinity).sort((a, b) => b - a);
  const fitsDims = itemMm.every((d, i) => d <= limMm[i]);
  const fitsWeight = parcel.max_weight_g == null || c.weight_g == null || c.weight_g <= parcel.max_weight_g;
  return (fitsDims && fitsWeight) ? "fits_parcel" : "needs_dhl";
}

const VERDICT_META: Record<FitVerdict, { label: string; cls: string }> = {
  fits_parcel: { label: "Fits Parcel — check courier", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  needs_dhl:   { label: "Genuinely DHL — raise price", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  unknown:     { label: "Needs dims", cls: "bg-muted text-muted-foreground border-border" },
};

// Generic: does the item fit within a given format's limits? "fits" / "too_big" / "unknown".
function fitsFormat(c: { length_cm: number | null; depth_cm: number | null; height_cm: number | null; weight_g: number | null }, fmt: FormatService | undefined): "fits" | "too_big" | "unknown" {
  if (!fmt) return "unknown";
  const dims = [c.length_cm, c.depth_cm, c.height_cm];
  if (dims.some(d => d == null || d <= 0)) return "unknown";
  const itemMm = (dims as number[]).map(d => d * 10).sort((a, b) => b - a);
  const limMm = [fmt.max_length_mm, fmt.max_width_mm, fmt.max_height_mm].map(v => v ?? Infinity).sort((a, b) => b - a);
  const fitsDims = itemMm.every((d, i) => d <= limMm[i]);
  const fitsWeight = fmt.max_weight_g == null || c.weight_g == null || c.weight_g <= fmt.max_weight_g;
  return (fitsDims && fitsWeight) ? "fits" : "too_big";
}

interface DowngradeCandidate {
  sku: string; product_name: string | null; brand_name: string | null;
  orders: number; single_item_orders: number;
  avg_price: number; avg_courier: number;
  length_cm: number | null; depth_cm: number | null; height_cm: number | null; weight_g: number | null;
  review_verdict: string | null;
}

type Mode = "margin" | "downgrade";

export default function CourierMargin() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("margin");
  const [courier, setCourier] = useState("dhl");
  const [days, setDays] = useState(90);
  const [minOrders, setMinOrders] = useState(3);
  const [singleOnly, setSingleOnly] = useState(true);
  const [pctThreshold, setPctThreshold] = useState(40);   // courier ≥ % of price
  const [marginFloor, setMarginFloor] = useState(2);      // net margin < £
  const [verdictFilter, setVerdictFilter] = useState<"all" | FitVerdict | "unconfirmed">("all");
  const [dgSort, setDgSort] = useState<"total" | "per_order">("total");

  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const { data: formats = [] } = useQuery({
    queryKey: ["format-services"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("carrier_format_services").select("*");
      if (error) throw error;
      return data as (FormatService & { price_pence: number | null })[];
    },
  });
  const parcel = formats.find(f => f.slug === "parcel");
  const largeLetter = formats.find(f => f.slug === "large-letter");
  const llPrice = largeLetter?.price_pence != null ? largeLetter.price_pence / 100 : null;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["courier-margin", courier, days, minOrders, singleOnly],
    enabled: mode === "margin",
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_courier_margin_candidates", {
        from_date: fmt(from), to_date: fmt(to),
        courier_pattern: courier, min_orders: minOrders, single_item_only: singleOnly,
      });
      if (error) throw error;
      return data as Candidate[];
    },
  });

  const { data: dgRows = [], isLoading: dgLoading } = useQuery({
    queryKey: ["downgrade", days, minOrders, singleOnly],
    enabled: mode === "downgrade",
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_downgrade_candidates", {
        from_date: fmt(from), to_date: fmt(to), min_orders: minOrders, single_item_only: singleOnly,
      });
      if (error) throw error;
      return data as DowngradeCandidate[];
    },
  });

  // Downgrade rows that fit Large Letter and paid more than the LL rate.
  const downgrades = useMemo(() => {
    if (llPrice == null) return [];
    return dgRows
      .map(r => {
        const fit = fitsFormat(r, largeLetter);
        const perOrder = Math.max(0, r.avg_courier - llPrice);
        return { ...r, _fit: fit, perOrder, total: perOrder * r.orders };
      })
      .filter(r => r._fit === "fits" && r.perOrder > 0.05)
      .sort((a, b) => dgSort === "total" ? b.total - a.total : b.perOrder - a.perOrder);
  }, [dgRows, largeLetter, llPrice, dgSort]);

  const dgNeedsDims = useMemo(
    () => dgRows.filter(r => fitsFormat(r, largeLetter) === "unknown" && r.avg_courier > (llPrice ?? 1.65)).length,
    [dgRows, largeLetter, llPrice]);

  const reviewMutation = useMutation({
    mutationFn: async ({ sku, verdict, note }: { sku: string; verdict: string; note?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("courier_margin_reviews").upsert({
        sku, verdict, note: note ?? null, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["courier-margin"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  // Apply threshold + verdict filters client-side
  const filtered = useMemo(() => {
    return rows
      .map(r => ({ ...r, _fit: parcelFit(r, parcel ?? undefined) }))
      .filter(r => {
        const hitsPct = r.courier_pct >= pctThreshold;
        const hitsMargin = r.avg_margin != null && r.avg_margin < marginFloor;
        if (!hitsPct && !hitsMargin) return false;
        if (verdictFilter === "all") return true;
        if (verdictFilter === "unconfirmed") return !r.review_verdict;
        return r._fit === verdictFilter;
      });
  }, [rows, parcel, pctThreshold, marginFloor, verdictFilter]);

  const stats = useMemo(() => {
    const fixable = filtered.filter(r => r._fit === "fits_parcel").length;
    const genuine = filtered.filter(r => r._fit === "needs_dhl").length;
    const unknown = filtered.filter(r => r._fit === "unknown").length;
    const lostPerOrder = filtered.reduce((a, r) => a + Math.max(0, r.avg_courier - r.avg_price * (pctThreshold / 100)), 0);
    return { fixable, genuine, unknown, total: filtered.length };
  }, [filtered, pctThreshold]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Courier Margin"
        description="Where the courier fee is eating the profit, and where a cheaper format would do."
        icon={Truck}
      />

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-border p-1 bg-muted/30">
        <button
          onClick={() => setMode("margin")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === "margin" ? "bg-pd-accent text-white" : "text-muted-foreground hover:text-foreground"}`}
        >
          Margin killers
        </button>
        <button
          onClick={() => setMode("downgrade")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === "downgrade" ? "bg-pd-accent text-white" : "text-muted-foreground hover:text-foreground"}`}
        >
          Downgrade savings
        </button>
      </div>

      {mode === "downgrade" ? (
        <DowngradeView
          rows={downgrades} needsDims={dgNeedsDims} loading={dgLoading}
          llPrice={llPrice} largeLetter={largeLetter}
          days={days} setDays={setDays} minOrders={minOrders} setMinOrders={setMinOrders}
          singleOnly={singleOnly} setSingleOnly={setSingleOnly}
          sort={dgSort} setSort={setDgSort}
          onReview={(sku, verdict) => reviewMutation.mutate({ sku, verdict })}
        />
      ) : (
      <>
      {/* Filters */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Courier</Label>
            <Select value={courier} onValueChange={setCourier}>
              <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dhl">DHL</SelectItem>
                <SelectItem value="royal mail">Royal Mail</SelectItem>
                <SelectItem value="evri">Evri</SelectItem>
                <SelectItem value="dpd">DPD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Window</Label>
            <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
              <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 180 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Min orders</Label>
            <Input type="number" min={1} value={minOrders} onChange={e => setMinOrders(Number(e.target.value) || 1)} className="w-20 h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Courier ≥ % of price</Label>
            <Input type="number" min={0} value={pctThreshold} onChange={e => setPctThreshold(Number(e.target.value) || 0)} className="w-24 h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Margin &lt; £</Label>
            <Input type="number" step="0.5" value={marginFloor} onChange={e => setMarginFloor(Number(e.target.value))} className="w-20 h-9" />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch checked={singleOnly} onCheckedChange={setSingleOnly} id="single" />
            <Label htmlFor="single" className="text-xs cursor-pointer">Single-item orders only</Label>
          </div>
          <div className="space-y-1.5 ml-auto">
            <Label className="text-xs">Verdict</Label>
            <Select value={verdictFilter} onValueChange={v => setVerdictFilter(v as any)}>
              <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="needs_dhl">Genuinely DHL (raise price)</SelectItem>
                <SelectItem value="fits_parcel">Fits Parcel (fix courier)</SelectItem>
                <SelectItem value="unknown">Needs dims</SelectItem>
                <SelectItem value="unconfirmed">Not yet confirmed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Flagged SKUs" value={stats.total} />
        <Stat label="Fits Parcel — check courier" value={stats.fixable} className="text-amber-400" />
        <Stat label="Genuinely DHL — raise price" value={stats.genuine} className="text-destructive" />
        <Stat label="Needs dims" value={stats.unknown} className="text-muted-foreground" />
      </div>

      <div className="rounded-lg border border-pd-accent/20 bg-pd-accent/5 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-pd-accent flex-shrink-0 mt-0.5" />
        <span>
          Single-item orders isolate the true courier burden (multi-item orders share one courier fee).
          "Fits Parcel" = dims/weight are within the Parcel limit, so it likely shouldn't be going {courier.toUpperCase()} — check the courier mapping.
          "Genuinely DHL" = too big/heavy for Parcel, so the fix is a price increase. "Needs dims" = add dimensions to decide.
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? <PageLoader rows={10} columns={[120, 200, 70, 70, 70, 70, 140, 120]} label="Loading courier margins" /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Avg price</TableHead>
                    <TableHead className="text-right">Avg courier</TableHead>
                    <TableHead className="text-right">Courier %</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                    <TableHead>Dims (L×D×H cm / g)</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead className="text-right">Confirm</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      No SKUs match the current thresholds.
                    </TableCell></TableRow>
                  )}
                  {filtered.map(r => {
                    const meta = VERDICT_META[r._fit];
                    const dimStr = [r.length_cm, r.depth_cm, r.height_cm].every(d => d != null && d > 0)
                      ? `${r.length_cm}×${r.depth_cm}×${r.height_cm} / ${r.weight_g ?? "?"}g`
                      : r.weight_g ? `— / ${r.weight_g}g` : "—";
                    return (
                      <TableRow key={r.sku} className={r.review_verdict ? "opacity-60" : ""}>
                        <TableCell>
                          <Link to={`/discovery/products?search=${encodeURIComponent(r.sku)}`} className="font-mono text-xs text-pd-accent hover:underline">{r.sku}</Link>
                        </TableCell>
                        <TableCell className="text-sm max-w-[220px] truncate">{r.product_name ?? "—"}</TableCell>
                        <TableCell className="text-right text-sm">{r.orders}{r.single_item_orders < r.orders ? <span className="text-muted-foreground text-xs"> ({r.single_item_orders} solo)</span> : null}</TableCell>
                        <TableCell className="text-right text-sm">£{r.avg_price.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm">£{r.avg_courier.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`font-semibold ${r.courier_pct >= 100 ? "text-destructive" : r.courier_pct >= 50 ? "text-amber-400" : "text-foreground"}`}>
                            {r.courier_pct}%
                          </span>
                        </TableCell>
                        <TableCell className={`text-right text-sm ${(r.avg_margin ?? 0) < 0 ? "text-destructive font-semibold" : ""}`}>
                          {r.avg_margin != null ? `£${r.avg_margin.toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{dimStr}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${meta.cls}`}>{meta.label}</Badge>
                          {r.review_verdict && (
                            <div className="text-[10px] text-emerald-400 mt-0.5">✓ {r.review_verdict.replace("_", " ")}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" title="Confirm: genuinely needs courier — raise price"
                              onClick={() => reviewMutation.mutate({ sku: r.sku, verdict: "genuinely_dhl" })}>
                              <PoundSterling className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-400" title="Confirm: wrong courier — fix routing"
                              onClick={() => reviewMutation.mutate({ sku: r.sku, verdict: "fix_courier" })}>
                              <ArrowDownUp className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" title="Ignore"
                              onClick={() => reviewMutation.mutate({ sku: r.sku, verdict: "ignore" })}>
                              <Check className="h-3 w-3" />
                            </Button>
                          </div>
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
      <p className="text-xs text-muted-foreground pb-4">
        Actual courier cost from order economics. Parcel limit:{" "}
        {parcel ? `${parcel.max_length_mm}×${parcel.max_width_mm}×${parcel.max_height_mm}mm, ${parcel.max_weight_g}g` : "not configured"}
        {" "}— edit in <Link to="/operations/carriers/settings" className="text-pd-accent hover:underline">Carrier Settings → Format Services</Link>.
        Confirm actions: <PoundSterling className="h-3 w-3 inline" /> raise price · <ArrowDownUp className="h-3 w-3 inline" /> fix courier · <Check className="h-3 w-3 inline" /> ignore.
      </p>
      </>
      )}
    </div>
  );
}

// ── Downgrade savings view (Parcel → Large Letter) ────────────────
function DowngradeView({ rows, needsDims, loading, llPrice, largeLetter, days, setDays, minOrders, setMinOrders, singleOnly, setSingleOnly, sort, setSort, onReview }: {
  rows: (DowngradeCandidate & { _fit: string; perOrder: number; total: number })[];
  needsDims: number; loading: boolean; llPrice: number | null; largeLetter: FormatService | undefined;
  days: number; setDays: (n: number) => void; minOrders: number; setMinOrders: (n: number) => void;
  singleOnly: boolean; setSingleOnly: (b: boolean) => void;
  sort: "total" | "per_order"; setSort: (s: "total" | "per_order") => void;
  onReview: (sku: string, verdict: string) => void;
}) {
  const totalSaving = rows.reduce((a, r) => a + r.total, 0);
  return (
    <>
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Window</Label>
            <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
              <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 180 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Min orders</Label>
            <Input type="number" min={1} value={minOrders} onChange={e => setMinOrders(Number(e.target.value) || 1)} className="w-20 h-9" />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch checked={singleOnly} onCheckedChange={setSingleOnly} id="dg-single" />
            <Label htmlFor="dg-single" className="text-xs cursor-pointer">Single-item orders only</Label>
          </div>
          <div className="space-y-1.5 ml-auto">
            <Label className="text-xs">Sort by</Label>
            <Select value={sort} onValueChange={v => setSort(v as any)}>
              <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="total">Total £ saving</SelectItem>
                <SelectItem value="per_order">Per-order saving</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {llPrice == null && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-400">
            Set the Large Letter price in <Link to="/operations/carriers/settings" className="underline">Carrier Settings → Format Services</Link> to calculate savings.
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="SKUs that could downgrade" value={rows.length} className="text-amber-400" />
        <StatMoney label="Total saving (window)" value={totalSaving} className="text-emerald-400" />
        <Stat label="Need dims to assess" value={needsDims} className="text-muted-foreground" />
      </div>

      <div className="rounded-lg border border-pd-accent/20 bg-pd-accent/5 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Ruler className="h-4 w-4 text-pd-accent flex-shrink-0 mt-0.5" />
        <span>
          These SKUs ship on a parcel service but fit within Large Letter limits
          {largeLetter ? ` (${largeLetter.max_length_mm}×${largeLetter.max_width_mm}×${largeLetter.max_height_mm}mm, ≤${largeLetter.max_weight_g}g)` : ""}.
          Saving = actual courier paid − Large Letter rate (£{llPrice?.toFixed(2) ?? "—"}). Switching the courier mapping captures it.
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? <PageLoader rows={10} columns={[120, 200, 70, 70, 70, 90, 90, 140]} label="Loading downgrade savings" /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Avg paid</TableHead>
                    <TableHead className="text-right">LL rate</TableHead>
                    <TableHead className="text-right">Per-order saving</TableHead>
                    <TableHead className="text-right">Total saving</TableHead>
                    <TableHead>Dims (L×D×H cm / g)</TableHead>
                    <TableHead className="text-right">Confirm</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No downgrade opportunities found {llPrice == null ? "(set the Large Letter price first)" : "in this window"}.
                    </TableCell></TableRow>
                  )}
                  {rows.map(r => (
                    <TableRow key={r.sku} className={r.review_verdict ? "opacity-60" : ""}>
                      <TableCell>
                        <Link to={`/discovery/products?search=${encodeURIComponent(r.sku)}`} className="font-mono text-xs text-pd-accent hover:underline">{r.sku}</Link>
                      </TableCell>
                      <TableCell className="text-sm max-w-[220px] truncate">{r.product_name ?? "—"}</TableCell>
                      <TableCell className="text-right text-sm">{r.orders}</TableCell>
                      <TableCell className="text-right text-sm">£{r.avg_courier.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">£{llPrice?.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm text-emerald-400">£{r.perOrder.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-400">£{r.total.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.length_cm}×{r.depth_cm}×{r.height_cm} / {r.weight_g ?? "?"}g</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-400" title="Confirm: switch to Large Letter"
                            onClick={() => onReview(r.sku, "fix_courier")}>
                            <ArrowDownUp className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" title="Ignore"
                            onClick={() => onReview(r.sku, "ignore")}>
                            <Check className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StatMoney({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <Card><CardContent className="pt-6">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${className}`}>£{value.toFixed(2)}</div>
    </CardContent></Card>
  );
}

function Stat({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <Card><CardContent className="pt-6">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${className}`}>{value}</div>
    </CardContent></Card>
  );
}
