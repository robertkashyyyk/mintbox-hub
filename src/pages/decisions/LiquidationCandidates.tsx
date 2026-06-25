/**
 * Liquidation Candidates — Price Campaigns (Phases 1–3) + enhancements.
 *
 * Surfaces slow/dead stock by capital tied up, lets you launch clearance
 * campaigns (single or bulk) that ring-fence the SKU from the repricer, push a
 * discounted price via 3D/SFTP, and revert. Plus: suggested discount, sortable
 * columns, last-sold staleness, snooze/exclude, CSV export, capital KPIs.
 */

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Flame, Loader2, PoundSterling, Boxes, AlertTriangle, RotateCcw, CheckCircle2, Plus, Trash2, Send, Download, ArrowUpDown, EyeOff, Eye, Wand2, List as ListIcon, LayoutGrid, LineChart as LineChartIcon, Tag, Clock, TrendingDown, TrendingUp, History } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { logisticsBreakevenFloor, bandRecoveryTarget } from "@/lib/reprice";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend } from "recharts";

interface Candidate {
  sku: string; product_name: string | null; brand_name: string | null;
  current_stock: number; cost_price: number; velocity_per_week: number;
  units_sold_90d: number | null; weeks_of_cover: number | null; capital_tied: number;
  last_sold: string | null; in_campaign: boolean; is_excluded: boolean;
}
interface Campaign {
  id: string; sku: string; type: string; status: string; stage: string | null;
  original_price: number | null; campaign_price: number | null; discount_pct: number | null;
  baseline_velocity: number | null; baseline_stock: number | null;
  start_date: string; end_date: string | null; pushed_at: string | null; notes: string | null;
  recovery_step: number | null; recovery_weeks: number | null; recovery_next_at: string | null;
}
interface KnownListing { listing_sku: string; store_id: string; store_name: string; mintsoft_channel: string; current_price: number; last_sold: string }
interface Store { id: string; store_name: string }
type ListingRow = { store_id: string; listing_sku: string; store_name: string; current: number };

// Logistics-breakeven floor (gross): below this the sale itself loses money
// (fees + courier exceed what we get). Cost is ignored — dead stock is sunk.
// Computed once with eBay defaults; ~£2.82 at fee 12% + £0.36 fixed + £1.65 courier.
const LIQUIDATION_FLOOR = logisticsBreakevenFloor() ?? 0;

// Suggested clearance depth based on how dead the SKU is.
function suggestDiscount(c: Candidate): number {
  if (!c.units_sold_90d && !c.last_sold) return 40;          // never sold
  if (c.weeks_of_cover == null || c.weeks_of_cover > 156) return 40; // 3yr+ cover
  if (c.weeks_of_cover > 78) return 30;
  if (c.weeks_of_cover > 39) return 25;
  if (c.weeks_of_cover > 20) return 20;
  return 15;
}

async function pushPerStore(rows: { store_id: string; listing_sku: string; price: number }[]) {
  const byStore = new Map<string, { sku: string; new_price: number }[]>();
  for (const r of rows) {
    if (!r.store_id) continue;
    if (!byStore.has(r.store_id)) byStore.set(r.store_id, []);
    byStore.get(r.store_id)!.push({ sku: r.listing_sku, new_price: r.price });
  }
  let pushed = 0, failed = 0;
  for (const [store_id, storeRows] of byStore) {
    // Tag as liquidation so the Repricing Payoff report excludes clearance cuts.
    const { error } = await supabase.functions.invoke("threeds-reprice-push", { body: { store_id, rows: storeRows, source: "liquidation" } });
    if (error) failed += storeRows.length; else pushed += storeRows.length;
  }
  return { pushed, failed };
}

// Shared: create a campaign + listing snapshots, clear stale pending, push.
// `type` distinguishes a time-boxed Sale (restored at end_date via the review
// loop) from a clear-and-forget Liquidation. saleWeeks sets the Sale's end_date.
async function launchCampaign(opts: {
  candidate: Candidate; listings: ListingRow[]; pct: number;
  type: "sale" | "liquidation"; saleWeeks?: number; notes?: string; userId: string | null;
}): Promise<{ pushed: number; failed: number; recordOnly: boolean }> {
  const { candidate, listings, pct, type, saleWeeks, notes, userId } = opts;
  const sale = (cur: number) => Math.max(0, Number((cur * (1 - pct / 100)).toFixed(2)));
  const base = listings.length ? [...listings].sort((a, b) => a.current - b.current)[0] : null;
  const endDate = type === "sale" && saleWeeks
    ? new Date(Date.now() + saleWeeks * 7 * 86_400_000).toISOString().slice(0, 10)
    : null;
  const { data: camp, error: cErr } = await (supabase as any).from("price_campaigns").insert({
    sku: candidate.sku, type, status: "active", discount_pct: pct, end_date: endDate,
    original_price: base?.current ?? null, campaign_price: base ? sale(base.current) : null,
    baseline_velocity: candidate.velocity_per_week, baseline_stock: candidate.current_stock, baseline_cost: candidate.cost_price,
    notes: notes?.trim() || null, created_by: userId,
  }).select("id").single();
  if (cErr) throw new Error(cErr.code === "23505" ? `${candidate.sku} already has an active campaign` : cErr.message);

  if (listings.length) {
    await (supabase as any).from("price_campaign_listings").insert(listings.map(l => ({
      campaign_id: camp.id, listing_sku: l.listing_sku, store_id: l.store_id, store_name: l.store_name,
      original_price: l.current, sale_price: sale(l.current),
    })));
    await (supabase as any).rpc("clear_pending_for_base_sku", { p_base_sku: candidate.sku });
    const res = await pushPerStore(listings.map(l => ({ store_id: l.store_id, listing_sku: l.listing_sku, price: sale(l.current) })));
    await (supabase as any).from("price_campaigns").update({ pushed_at: new Date().toISOString() }).eq("id", camp.id);
    return { ...res, recordOnly: false };
  }
  return { pushed: 0, failed: 0, recordOnly: true };
}

async function fetchListings(sku: string): Promise<ListingRow[]> {
  const { data } = await (supabase as any).rpc("get_campaign_listings_for_sku", { p_base_sku: sku });
  return ((data ?? []) as KnownListing[]).map(l => ({ store_id: l.store_id, listing_sku: l.listing_sku, store_name: l.store_name, current: l.current_price }));
}

type SortKey = "capital_tied" | "weeks_of_cover" | "current_stock" | "velocity_per_week" | "last_sold";

export default function LiquidationCandidates() {
  const qc = useQueryClient();
  const [maxVelocity, setMaxVelocity] = useState(0.5);
  const [minCapital, setMinCapital] = useState(25);
  const [brandFilter, setBrandFilter] = useState("all");
  const [showExcluded, setShowExcluded] = useState(false);
  const [view, setView] = useState<"list" | "brands" | "graphs">("list");
  const [launch, setLaunch] = useState<{ candidate: Candidate; intent: "sale" | "liquidation" } | null>(null);
  const [bulkIntent, setBulkIntent] = useState<"sale" | "liquidation" | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("capital_tied");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const TOP_N = 500;

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["liquidation-candidates", maxVelocity, minCapital, showExcluded, brandFilter],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_liquidation_candidates", {
        max_velocity: maxVelocity, min_capital: minCapital, limit_n: TOP_N,
        include_excluded: showExcluded, p_brand: brandFilter === "all" ? null : brandFilter,
      });
      if (error) throw error;
      return data as Candidate[];
    },
  });

  // Brand options come from a broad (brand-agnostic) candidate fetch so the
  // dropdown doesn't collapse once a brand is selected.
  const { data: brandList = [] } = useQuery({
    queryKey: ["liquidation-brands", maxVelocity, minCapital],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_liquidation_candidates", {
        max_velocity: maxVelocity, min_capital: minCapital, limit_n: 2000, include_excluded: true, p_brand: null,
      });
      if (error) throw error;
      return Array.from(new Set(((data ?? []) as Candidate[]).map(c => c.brand_name).filter(Boolean) as string[])).sort();
    },
  });
  const { data: totals } = useQuery({
    queryKey: ["liquidation-count", maxVelocity, minCapital, brandFilter],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_liquidation_candidate_count", {
        max_velocity: maxVelocity, min_capital: minCapital, p_brand: brandFilter === "all" ? null : brandFilter,
      });
      if (error) throw error;
      return (data?.[0] ?? { total: 0, total_capital: 0, dead_count: 0 }) as { total: number; total_capital: number; dead_count: number };
    },
  });
  const { data: clearance } = useQuery({
    queryKey: ["clearance-capital"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_clearance_capital");
      if (error) throw error;
      return (data?.[0] ?? { active_campaigns: 0, capital_under_clearance: 0, campaigns_run: 0 }) as { active_campaigns: number; capital_under_clearance: number; campaigns_run: number };
    },
  });
  const { data: campaigns = [] } = useQuery({
    queryKey: ["price-campaigns-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("price_campaigns").select("*").eq("status", "active").order("start_date", { ascending: false });
      if (error) throw error;
      // 'review'-stage sales live in the Sale Review card, not here.
      return (data as Campaign[]).filter(c => c.stage !== "review");
    },
  });
  const { data: stores = [] } = useQuery({
    queryKey: ["threeds-stores"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("threeds_stores").select("id, store_name").eq("enabled", true).order("store_name");
      if (error) throw error;
      return data as Store[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["price-campaigns-active"] });
    qc.invalidateQueries({ queryKey: ["liquidation-candidates"] });
    qc.invalidateQueries({ queryKey: ["clearance-capital"] });
    qc.invalidateQueries({ queryKey: ["liquidation-count"] });
    qc.invalidateQueries({ queryKey: ["sale-reviews"] });
  };

  const revertMutation = useMutation({
    mutationFn: async (campaign: Campaign) => {
      const { data: listings } = await (supabase as any).from("price_campaign_listings").select("listing_sku, store_id, original_price").eq("campaign_id", campaign.id);
      const rows = (listings ?? []).filter((l: any) => l.store_id && l.original_price != null).map((l: any) => ({ store_id: l.store_id, listing_sku: l.listing_sku, price: Number(l.original_price) }));
      let res = { pushed: 0, failed: 0 };
      if (rows.length) res = await pushPerStore(rows);
      await (supabase as any).from("price_campaigns").update({ status: "reverted", outcome: "reverted", reverted_at: new Date().toISOString(), end_date: new Date().toISOString().slice(0, 10) }).eq("id", campaign.id);
      await (supabase as any).from("price_campaign_listings").update({ reverted_at: new Date().toISOString() }).eq("campaign_id", campaign.id);
      return res;
    },
    onSuccess: (res) => { toast.success(`Reverted — ${res.pushed} price(s) pushed back${res.failed ? `, ${res.failed} failed` : ""}`); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const endMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await (supabase as any).from("price_campaigns").update({ status: "ended", end_date: new Date().toISOString().slice(0, 10) }).eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Campaign ended (price kept)"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const excludeMutation = useMutation({
    mutationFn: async ({ sku, remove }: { sku: string; remove?: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (remove) { await (supabase as any).from("liquidation_exclusions").delete().eq("sku", sku); }
      else { await (supabase as any).from("liquidation_exclusions").upsert({ sku, excluded_by: user?.id ?? null }); }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["liquidation-candidates"] }); qc.invalidateQueries({ queryKey: ["liquidation-count"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const brandOptions = brandList;
  const filtered = useMemo(() => {
    let r = candidates.filter(c => brandFilter === "all" || c.brand_name === brandFilter);
    const dir = sortDir === "asc" ? 1 : -1;
    r = [...r].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null) return 1; if (bv == null) return -1;
      if (sortKey === "last_sold") return dir * String(av).localeCompare(String(bv));
      return dir * (Number(av) - Number(bv));
    });
    return r;
  }, [candidates, brandFilter, sortKey, sortDir]);

  useEffect(() => { setPage(1); setSelected(new Set()); }, [maxVelocity, minCapital, brandFilter, showExcluded]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const trueTotal = totals?.total ?? 0;
  const trueCapital = Number(totals?.total_capital ?? 0);
  const capped = trueTotal > candidates.length;
  const selectedCandidates = filtered.filter(c => selected.has(c.sku));

  const toggleSort = (k: SortKey) => { if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir("desc"); } };
  const allPageSelected = pageRows.length > 0 && pageRows.every(c => selected.has(c.sku));

  function exportCsv() {
    const hdr = ["SKU","Product","Brand","Stock","Cost","Velocity/wk","Sold90d","WeeksCover","CapitalTied","LastSold","Suggested%"];
    const lines = filtered.map(c => [
      c.sku, c.product_name ?? "", c.brand_name ?? "", c.current_stock, c.cost_price, c.velocity_per_week,
      c.units_sold_90d ?? 0, c.weeks_of_cover ?? "", c.capital_tied, c.last_sold ?? "never", suggestDiscount(c),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[hdr.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `liquidation-candidates-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  }

  return (
    <div className="space-y-6">
      <ModuleHeader title="Liquidation Candidates" description="Dead stock tying up capital. Clear it with one click or in bulk — ring-fenced from the repricer, pushed to the channel, revertible." icon={Flame} />

      {/* Active campaigns */}
      {campaigns.length > 0 && (
        <Card className="border-orange-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Flame className="h-4 w-4 text-orange-500" /> Active campaigns ({campaigns.length})</CardTitle>
            <CardDescription>Ring-fenced from the repricer. Revert pushes original prices back.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>SKU</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Orig → Sale</TableHead><TableHead>Started</TableHead><TableHead>Reviews</TableHead><TableHead>State</TableHead><TableHead className="text-right">Action</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {campaigns.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.sku}</TableCell>
                      <TableCell>{c.stage === "recovering"
                        ? <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-500/30"><TrendingUp className="h-3 w-3 mr-1" />Recovering</Badge>
                        : c.type === "sale"
                        ? <Badge variant="outline" className="text-xs"><Tag className="h-3 w-3 mr-1" />Sale</Badge>
                        : <Badge variant="outline" className="text-xs text-orange-400 border-orange-500/30"><Flame className="h-3 w-3 mr-1" />Liq</Badge>}</TableCell>
                      <TableCell className="text-right text-sm">{c.discount_pct != null ? `${c.discount_pct}%` : "—"}</TableCell>
                      <TableCell className="text-right text-sm">{c.original_price != null ? `£${Number(c.original_price).toFixed(2)}` : "—"}<span className="text-orange-400"> → {c.campaign_price != null ? `£${Number(c.campaign_price).toFixed(2)}` : "—"}</span></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.start_date}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.stage === "recovering" ? `step ${c.recovery_step ?? 0}/${c.recovery_weeks ?? "—"}` : c.type === "sale" ? (c.end_date ?? "—") : <span className="opacity-50">—</span>}</TableCell>
                      <TableCell className="text-xs">{c.pushed_at ? <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 text-xs">Pushed</Badge> : <Badge variant="outline" className="text-xs">Record only</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => endMutation.mutate(c.id)}><CheckCircle2 className="h-3 w-3 mr-1" />End</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-amber-400" onClick={() => revertMutation.mutate(c)} disabled={revertMutation.isPending}>{revertMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RotateCcw className="h-3 w-3 mr-1" />Revert</>}</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sale Review — time-boxed sales that have reached their end date */}
      <SaleReviewCard stores={stores} onChanged={invalidate} />

      {/* View toggle */}
      <div className="inline-flex rounded-lg border border-border p-1 bg-muted/30">
        {([["list", "List", ListIcon], ["brands", "Brands", LayoutGrid], ["graphs", "Graphs", LineChartIcon]] as const).map(([v, label, Icon]) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1.5 ${view === v ? "bg-pd-accent text-white" : "text-muted-foreground hover:text-foreground"}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {view === "brands" && <BrandsTab maxVelocity={maxVelocity} minCapital={minCapital} setMaxVelocity={setMaxVelocity} setMinCapital={setMinCapital} />}
      {view === "graphs" && <GraphsTab />}

      {view === "list" && (<>
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 -mx-2 px-2 py-2 space-y-3 border-b border-border/40">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total candidates" value={trueTotal.toLocaleString()} icon={Boxes} />
          <Stat label="Capital tied up (all)" value={`£${trueCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} className="text-orange-400" icon={PoundSterling} />
          <Stat label="Under active clearance" value={`£${Number(clearance?.capital_under_clearance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} className="text-emerald-400" icon={Flame} />
          <Stat label="Dead (never sold)" value={(totals?.dead_count ?? 0).toLocaleString()} className="text-destructive" icon={AlertTriangle} />
        </div>
        <Card>
          <CardContent className="pt-4 pb-4 flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Brand</Label>
              <Select value={brandFilter} onValueChange={setBrandFilter}>
                <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All brands</SelectItem>{brandOptions.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Max velocity /wk</Label><Input type="number" step="0.1" value={maxVelocity} onChange={e => setMaxVelocity(Number(e.target.value))} className="w-28 h-9" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Min capital £</Label><Input type="number" value={minCapital} onChange={e => setMinCapital(Number(e.target.value) || 0)} className="w-24 h-9" /></div>
            <div className="flex items-center gap-2 pb-2"><Switch checked={showExcluded} onCheckedChange={setShowExcluded} id="excl" /><Label htmlFor="excl" className="text-xs cursor-pointer">Show snoozed</Label></div>
            <div className="ml-auto flex items-end gap-2">
              {selected.size > 0 && (<>
                <Button size="sm" className="h-9" onClick={() => setBulkIntent("sale")}>
                  <Tag className="h-4 w-4 mr-2" />Put {selected.size} on Sale
                </Button>
                <Button size="sm" className="h-9 bg-orange-500 hover:bg-orange-600 text-white" onClick={() => setBulkIntent("liquidation")}>
                  <Flame className="h-4 w-4 mr-2" />Liquidate {selected.size}
                </Button>
              </>)}
              <Button size="sm" variant="outline" className="h-9" onClick={exportCsv} disabled={filtered.length === 0}><Download className="h-4 w-4 mr-2" />Export</Button>
            </div>
          </CardContent>
        </Card>
        {capped && <p className="text-xs text-muted-foreground">Showing top {candidates.length.toLocaleString()} by capital of {trueTotal.toLocaleString()} — raise "min capital" to narrow.</p>}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <PageLoader rows={12} columns={[30, 110, 180, 70, 60, 60, 70, 90, 80, 110]} label="Loading candidates" /> : (
            <div>
              <Table containerClassName="max-h-[calc(100vh-240px)]">
                <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="w-8"><Checkbox checked={allPageSelected} onCheckedChange={(v) => setSelected(prev => { const n = new Set(prev); pageRows.forEach(c => v ? n.add(c.sku) : n.delete(c.sku)); return n; })} /></TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <SortableHead label="Stock" k="current_stock" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <TableHead className="text-right">Cost</TableHead>
                    <SortableHead label="Velocity" k="velocity_per_week" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableHead label="Cover" k="weeks_of_cover" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableHead label="Last sold" k="last_sold" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableHead label="Capital tied" k="capital_tied" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <TableHead className="text-right">Suggest</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No candidates at these thresholds.</TableCell></TableRow>}
                  {pageRows.map(c => (
                    <TableRow key={c.sku} className={c.is_excluded ? "opacity-50" : ""}>
                      <TableCell><Checkbox checked={selected.has(c.sku)} onCheckedChange={(v) => setSelected(prev => { const n = new Set(prev); v ? n.add(c.sku) : n.delete(c.sku); return n; })} /></TableCell>
                      <TableCell><Link to={`/discovery/products?search=${encodeURIComponent(c.sku)}`} className="font-mono text-xs text-pd-accent hover:underline">{c.sku}</Link></TableCell>
                      <TableCell className="text-sm max-w-[180px] truncate">{c.product_name ?? "—"}</TableCell>
                      <TableCell className="text-right text-sm">{c.current_stock}</TableCell>
                      <TableCell className="text-right text-sm">£{Number(c.cost_price).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{Number(c.velocity_per_week).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{c.weeks_of_cover != null ? `${c.weeks_of_cover >= 999 ? "999+" : c.weeks_of_cover}w` : <span className="text-destructive">dead</span>}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{c.last_sold ?? <span className="text-destructive">never</span>}</TableCell>
                      <TableCell className="text-right font-semibold text-orange-400">£{Number(c.capital_tied).toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                      <TableCell className="text-right"><Badge variant="outline" className="text-xs">{suggestDiscount(c)}%</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="outline" className="h-7 text-xs" title="Time-boxed Sale — price restored at the end of the window" onClick={() => setLaunch({ candidate: c, intent: "sale" })}><Tag className="h-3 w-3 mr-1" />Sale</Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs text-orange-400 border-orange-500/30 hover:bg-orange-500/10" title="Liquidation — clear and forget (price not auto-restored)" onClick={() => setLaunch({ candidate: c, intent: "liquidation" })}><Flame className="h-3 w-3 mr-1" />Liq</Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title={c.is_excluded ? "Un-snooze" : "Snooze (hide from list)"} onClick={() => excludeMutation.mutate({ sku: c.sku, remove: c.is_excluded })}>
                            {c.is_excluded ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {filtered.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm text-muted-foreground">
              <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}{selected.size > 0 ? ` · ${selected.size} selected` : ""}</span>
              {pageCount > 1 && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <span className="self-center text-xs">Page {page} / {pageCount}</span>
                  <Button variant="outline" size="sm" disabled={page === pageCount} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      </>)}

      <LaunchDialog launch={launch} stores={stores} onClose={() => setLaunch(null)} onLaunched={() => { setLaunch(null); invalidate(); }} />
      <BulkDialog intent={bulkIntent} candidates={selectedCandidates} onClose={() => setBulkIntent(null)} onDone={() => { setBulkIntent(null); setSelected(new Set()); invalidate(); }} />
    </div>
  );
}

// ── Sale Review ────────────────────────────────────────────────────
// Time-boxed sales that have reached their end_date (moved to status='review'
// by process_due_sales). Shows window performance and the three decisions:
// remove from sale (restore price), hold (extend), or reduce further.
interface SaleReview {
  id: string; sku: string; discount_pct: number | null;
  original_price: number | null; campaign_price: number | null;
  baseline_velocity: number | null; baseline_cost: number | null; start_date: string; end_date: string | null; notes: string | null;
  units_sold_window: number; revenue_window: number; days_live: number;
}

// Mark any open sale-review task for this campaign as done (best-effort).
async function closeSaleTask(campaignId: string) {
  try {
    await (supabase as any).from("tasks").update({ status: "done" })
      .eq("source_rule", "sale_review_due").eq("linked_entity_id", campaignId)
      .in("status", ["todo", "in_progress", "blocked"]);
  } catch { /* RLS may block non-owners — the task simply stays open */ }
}

async function campaignListingRows(campaignId: string, priceOf: (originalPrice: number) => number) {
  const { data } = await (supabase as any).from("price_campaign_listings")
    .select("listing_sku, store_id, original_price").eq("campaign_id", campaignId);
  return (data ?? [])
    .filter((l: any) => l.store_id && l.original_price != null)
    .map((l: any) => ({ store_id: l.store_id, listing_sku: l.listing_sku, price: priceOf(Number(l.original_price)) }));
}

function SaleReviewCard({ stores: _stores, onChanged }: { stores: Store[]; onChanged: () => void }) {
  const [reduceTarget, setReduceTarget] = useState<SaleReview | null>(null);
  const [reducePct, setReducePct] = useState("");
  const [recoverTarget, setRecoverTarget] = useState<SaleReview | null>(null);
  const [recoverWeeks, setRecoverWeeks] = useState("4");

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ["sale-reviews"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_sale_reviews");
      if (error) throw error;
      return data as SaleReview[];
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (r: SaleReview) => {
      const rows = await campaignListingRows(r.id, (orig) => orig); // restore original prices
      let res = { pushed: 0, failed: 0 };
      if (rows.length) res = await pushPerStore(rows);
      await (supabase as any).from("price_campaigns").update({
        status: "ended", stage: null, outcome: "worked", reverted_at: new Date().toISOString(), end_date: new Date().toISOString().slice(0, 10),
      }).eq("id", r.id);
      await (supabase as any).from("price_campaign_listings").update({ reverted_at: new Date().toISOString() }).eq("campaign_id", r.id);
      await closeSaleTask(r.id);
      return res;
    },
    onSuccess: (res) => { toast.success(`Removed from sale — ${res.pushed} price(s) restored${res.failed ? `, ${res.failed} failed` : ""}`); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });

  const holdMutation = useMutation({
    mutationFn: async (r: SaleReview) => {
      const newEnd = new Date(Date.now() + 4 * 7 * 86_400_000).toISOString().slice(0, 10);
      const { error } = await (supabase as any).from("price_campaigns").update({ status: "active", stage: "selling", end_date: newEnd, outcome: "too_early", recovery_step: 0, recovery_weeks: null, recovery_next_at: null }).eq("id", r.id);
      if (error) throw error;
      await closeSaleTask(r.id);
      return newEnd;
    },
    onSuccess: (newEnd) => { toast.success(`Held on sale — reviews again on ${newEnd}`); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });

  const reduceMutation = useMutation({
    mutationFn: async ({ r, pct }: { r: SaleReview; pct: number }) => {
      const priceOf = (orig: number) => Math.max(0, Number((orig * (1 - pct / 100)).toFixed(2)));
      const rows = await campaignListingRows(r.id, priceOf);
      let res = { pushed: 0, failed: 0 };
      if (rows.length) res = await pushPerStore(rows);
      const newEnd = new Date(Date.now() + 4 * 7 * 86_400_000).toISOString().slice(0, 10);
      const newCampaignPrice = r.original_price != null ? priceOf(Number(r.original_price)) : null;
      await (supabase as any).from("price_campaigns").update({
        status: "active", stage: "selling", discount_pct: pct, campaign_price: newCampaignPrice, end_date: newEnd, outcome: "no_effect", recovery_step: 0, recovery_weeks: null, recovery_next_at: null,
      }).eq("id", r.id);
      await closeSaleTask(r.id);
      return res;
    },
    onSuccess: (res) => { toast.success(`Reduced further — ${res.pushed} price(s) pushed${res.failed ? `, ${res.failed} failed` : ""}`); setReduceTarget(null); setReducePct(""); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });

  const recoverMutation = useMutation({
    mutationFn: async ({ r, weeks }: { r: SaleReview; weeks: number }) => {
      const nextAt = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      const target = r.baseline_cost != null ? bandRecoveryTarget({ costUnit: Number(r.baseline_cost) }) : null;
      const { error } = await (supabase as any).from("price_campaigns").update({
        status: "active", stage: "recovering", outcome: "worked",
        recovery_weeks: weeks, recovery_step: 0, recovery_next_at: nextAt, recovery_target_price: target,
      }).eq("id", r.id);
      if (error) throw error;
      await closeSaleTask(r.id);
      return weeks;
    },
    onSuccess: (weeks) => { toast.success(`Recovering to band over ${weeks} week(s) — prices step up weekly, then it hands back to the repricer`); setRecoverTarget(null); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || reviews.length === 0) return null;

  const busy = removeMutation.isPending || holdMutation.isPending || reduceMutation.isPending || recoverMutation.isPending;

  return (
    <Card className="border-pd-accent/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-pd-accent" /> Sale Review ({reviews.length})</CardTitle>
        <CardDescription>Timed sales that have hit their end date. Restore the price, hold for longer, or reduce further.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Orig → Sale</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead>Window</TableHead>
              <TableHead className="text-right">Sold (sale)</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {reviews.map(r => {
                const weeksLive = Math.max(r.days_live / 7, 0);
                const expected = r.baseline_velocity != null ? Math.round(Number(r.baseline_velocity) * weeksLive) : null;
                const beat = expected != null && r.units_sold_window > expected;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                    <TableCell className="text-right text-sm">{r.original_price != null ? `£${Number(r.original_price).toFixed(2)}` : "—"}<span className="text-pd-accent"> → {r.campaign_price != null ? `£${Number(r.campaign_price).toFixed(2)}` : "—"}</span></TableCell>
                    <TableCell className="text-right text-sm">{r.discount_pct != null ? `${r.discount_pct}%` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.start_date} → {r.end_date ?? "—"} <span className="opacity-70">({r.days_live}d)</span></TableCell>
                    <TableCell className="text-right text-sm font-semibold">{r.units_sold_window}{r.revenue_window > 0 && <span className="text-muted-foreground font-normal"> · £{Number(r.revenue_window).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}</TableCell>
                    <TableCell className="text-right text-xs"><span className={beat ? "text-emerald-400" : "text-muted-foreground"}>{expected != null ? `~${expected}` : "—"}</span></TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-400" disabled={busy} title="Step the price back up to the normal band over a few weeks, then hand back to the repricer" onClick={() => { setRecoverTarget(r); setRecoverWeeks("4"); }}><TrendingUp className="h-3 w-3 mr-1" />Recover</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} title="Snap the price straight back to pre-sale" onClick={() => removeMutation.mutate(r)}><RotateCcw className="h-3 w-3 mr-1" />Remove</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} title="Hold the sale for another 4 weeks" onClick={() => holdMutation.mutate(r)}><Clock className="h-3 w-3 mr-1" />Hold</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-orange-400" disabled={busy} title="Cut the price further" onClick={() => { setReduceTarget(r); setReducePct(String((r.discount_pct ?? 0) + 10)); }}><TrendingDown className="h-3 w-3 mr-1" />Reduce</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={!!reduceTarget} onOpenChange={(o) => { if (!o) { setReduceTarget(null); setReducePct(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono">{reduceTarget?.sku}</DialogTitle>
            <DialogDescription>Reduce further off the original price (£{Number(reduceTarget?.original_price ?? 0).toFixed(2)}). Re-pushes and resets a fresh 4-week window.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>New discount %</Label>
            <Input type="number" min={1} max={95} value={reducePct} onChange={e => setReducePct(e.target.value)} className="w-28" />
            {reduceTarget?.original_price != null && Number(reducePct) > 0 && (() => {
              const newPrice = Math.max(0, Number(reduceTarget.original_price) * (1 - Number(reducePct) / 100));
              const belowFloor = newPrice < LIQUIDATION_FLOOR;
              return (
                <p className={`text-xs ${belowFloor ? "text-destructive" : "text-muted-foreground"}`}>
                  New price ≈ £{newPrice.toFixed(2)}{belowFloor && ` ⚠ below the £${LIQUIDATION_FLOOR.toFixed(2)} logistics floor — the sale itself would lose money`}
                </p>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReduceTarget(null); setReducePct(""); }}>Cancel</Button>
            <Button disabled={reduceMutation.isPending || !(Number(reducePct) > 0) || !reduceTarget} className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => reduceTarget && reduceMutation.mutate({ r: reduceTarget, pct: Number(reducePct) })}>
              {reduceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TrendingDown className="h-4 w-4 mr-2" />}Reduce &amp; push
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!recoverTarget} onOpenChange={(o) => { if (!o) setRecoverTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono">{recoverTarget?.sku}</DialogTitle>
            <DialogDescription>
              Step the price from the sale price back up to pre-sale over N weeks, then end the campaign so the repricer manages it to the normal band.
              {recoverTarget?.baseline_cost != null && (() => { const b = bandRecoveryTarget({ costUnit: Number(recoverTarget.baseline_cost) }); return b ? ` Normal band ≈ £${b.toFixed(2)}.` : ""; })()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label className="flex items-center gap-1"><Clock className="h-3 w-3" />Recover over (weeks)</Label>
            <Input type="number" min={1} max={26} value={recoverWeeks} onChange={e => setRecoverWeeks(e.target.value)} className="w-28" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecoverTarget(null)}>Cancel</Button>
            <Button disabled={recoverMutation.isPending || !(Number(recoverWeeks) > 0) || !recoverTarget} className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => recoverTarget && recoverMutation.mutate({ r: recoverTarget, weeks: Number(recoverWeeks) })}>
              {recoverMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TrendingUp className="h-4 w-4 mr-2" />}Start recovery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SortableHead({ label, k, sortKey, sortDir, onSort }: { label: string; k: SortKey; sortKey: SortKey; sortDir: string; onSort: (k: SortKey) => void }) {
  return (
    <TableHead className="text-right">
      <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}<ArrowUpDown className={`h-3 w-3 ${sortKey === k ? "text-pd-accent" : "text-muted-foreground/40"}`} />
      </button>
    </TableHead>
  );
}

// ── Bulk clearance ─────────────────────────────────────────────────
function BulkDialog({ intent, candidates, onClose, onDone }: { intent: "sale" | "liquidation" | null; candidates: Candidate[]; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"sale" | "liquidation">("liquidation");
  const [weeks, setWeeks] = useState("4");
  const [mode, setMode] = useState<"fixed" | "suggested">("suggested");
  const [pct, setPct] = useState("25");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, pushed: 0, recordOnly: 0, failed: 0 });
  const isSale = kind === "sale";
  useEffect(() => { if (intent) setKind(intent); }, [intent]);

  async function run() {
    const saleWeeks = Number(weeks) || 0;
    if (isSale && saleWeeks <= 0) { toast.error("Set a sale length in weeks"); return; }
    setRunning(true);
    setProgress({ done: 0, pushed: 0, recordOnly: 0, failed: 0 });
    const { data: { user } } = await supabase.auth.getUser();
    let pushed = 0, recordOnly = 0, failed = 0;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const usePct = mode === "suggested" ? suggestDiscount(c) : Number(pct);
      try {
        const listings = await fetchListings(c.sku);
        const res = await launchCampaign({ candidate: c, listings, pct: usePct, type: kind, saleWeeks: isSale ? saleWeeks : undefined, userId: user?.id ?? null });
        if (res.recordOnly) recordOnly++; else pushed++;
      } catch { failed++; }
      setProgress({ done: i + 1, pushed, recordOnly, failed });
    }
    setRunning(false);
    toast.success(`Bulk ${isSale ? "sale" : "clearance"} — ${pushed} pushed, ${recordOnly} record-only, ${failed} failed`);
    onDone();
  }

  return (
    <Dialog open={!!intent} onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk {isSale ? "sale" : "clearance"} — {candidates.length} SKU{candidates.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Launches a {isSale ? "time-boxed sale" : "liquidation"} on each, pushes the discounted price where listings exist (record-only otherwise).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex gap-2">
            <Button variant={kind === "sale" ? "default" : "outline"} size="sm" onClick={() => setKind("sale")} className="flex-1"><Tag className="h-4 w-4 mr-1" />Sale (timed)</Button>
            <Button variant={kind === "liquidation" ? "default" : "outline"} size="sm" onClick={() => setKind("liquidation")} className="flex-1"><Flame className="h-4 w-4 mr-1" />Liquidation</Button>
          </div>
          {isSale && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1"><Clock className="h-3 w-3" />Sale length (weeks)</Label>
              <Input type="number" min={1} max={52} value={weeks} onChange={e => setWeeks(e.target.value)} className="w-28" />
              <p className="text-xs text-muted-foreground">Each SKU reviews {weeks && Number(weeks) > 0 ? `on ~${new Date(Date.now() + Number(weeks) * 7 * 86_400_000).toISOString().slice(0, 10)}` : "after the window"}.</p>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant={mode === "suggested" ? "default" : "outline"} size="sm" onClick={() => setMode("suggested")} className="flex-1"><Wand2 className="h-4 w-4 mr-1" />Suggested per SKU</Button>
            <Button variant={mode === "fixed" ? "default" : "outline"} size="sm" onClick={() => setMode("fixed")} className="flex-1">Fixed %</Button>
          </div>
          {mode === "fixed" && (
            <div className="space-y-1.5"><Label>Discount % (all)</Label><Input type="number" min={1} max={95} value={pct} onChange={e => setPct(e.target.value)} className="w-28" /></div>
          )}
          <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-xs space-y-1 max-h-40 overflow-y-auto">
            {candidates.slice(0, 30).map(c => (
              <div key={c.sku} className="flex justify-between"><span className="font-mono">{c.sku}</span><span className="text-orange-400">{mode === "suggested" ? suggestDiscount(c) : (Number(pct) || 0)}% off</span></div>
            ))}
            {candidates.length > 30 && <div className="text-muted-foreground">+ {candidates.length - 30} more…</div>}
          </div>
          {running && (
            <div className="text-sm text-muted-foreground">
              Processing {progress.done}/{candidates.length} — {progress.pushed} pushed, {progress.recordOnly} record-only, {progress.failed} failed
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={running}>Cancel</Button>
          <Button onClick={run} disabled={running || (mode === "fixed" && !(Number(pct) > 0))} className="bg-orange-500 hover:bg-orange-600 text-white">
            {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}{isSale ? "Start sale on" : "Clear"} {candidates.length} SKUs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Single launch (with manual entry for dead SKUs) ────────────────
function LaunchDialog({ launch, stores, onClose, onLaunched }: { launch: { candidate: Candidate; intent: "sale" | "liquidation" } | null; stores: Store[]; onClose: () => void; onLaunched: () => void }) {
  const candidate = launch?.candidate ?? null;
  const intent = launch?.intent ?? "sale";
  const isSale = intent === "sale";
  const [discount, setDiscount] = useState("");
  const [weeks, setWeeks] = useState("4");
  const [notes, setNotes] = useState("");
  const [manual, setManual] = useState<{ store_id: string; listing_sku: string; current_price: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: known = [], isLoading: knownLoading } = useQuery({
    queryKey: ["campaign-listings", candidate?.sku],
    enabled: !!candidate,
    queryFn: async () => fetchListings(candidate!.sku),
  });

  useEffect(() => { if (candidate) { setDiscount(String(suggestDiscount(candidate))); setWeeks("4"); setNotes(""); setManual([]); } }, [candidate]);

  const pct = Number(discount) || 0;
  const sale = (cur: number) => Math.max(0, Number((cur * (1 - pct / 100)).toFixed(2)));
  const allListings: ListingRow[] = useMemo(() => {
    const k = known as ListingRow[];
    const m = manual.filter(x => x.store_id && x.listing_sku && x.current_price).map(x => ({ store_id: x.store_id, listing_sku: x.listing_sku, store_name: stores.find(s => s.id === x.store_id)?.store_name ?? "?", current: Number(x.current_price) }));
    return [...k, ...m];
  }, [known, manual, stores]);

  async function launch() {
    if (!candidate) return;
    if (pct <= 0) { toast.error("Enter a discount %"); return; }
    if (allListings.length === 0) { toast.error("No listings — add one manually for a dead SKU"); return; }
    const saleWeeks = Number(weeks) || 0;
    if (isSale && saleWeeks <= 0) { toast.error("Set a sale length in weeks"); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const res = await launchCampaign({ candidate, listings: allListings, pct, type: intent, saleWeeks: isSale ? saleWeeks : undefined, notes, userId: user?.id ?? null });
      const label = isSale ? `Sale (${saleWeeks}w)` : "Liquidation";
      toast.success(`${candidate.sku} — ${label}, ${pct}% off, ${res.pushed} listing(s) pushed${res.failed ? `, ${res.failed} failed` : ""}`);
      onLaunched();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <Dialog open={!!candidate} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-mono flex items-center gap-2">
            {isSale ? <Tag className="h-4 w-4 text-pd-accent" /> : <Flame className="h-4 w-4 text-orange-500" />}
            {candidate?.sku}
            <Badge variant="outline" className={isSale ? "text-xs" : "text-xs text-orange-400 border-orange-500/30"}>{isSale ? "Sale" : "Liquidation"}</Badge>
          </DialogTitle>
          <DialogDescription>
            {isSale
              ? "Time-boxed price cut across every store + pack-size listing, pushed via SFTP. At the end of the window it surfaces in Sale Review to restore, hold or reduce further."
              : "Clear-and-forget discount across every store + pack-size listing, pushed via SFTP. The price is not auto-restored."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-xs grid grid-cols-3 gap-2">
            <div><span className="text-muted-foreground">Stock</span><div className="font-semibold">{candidate?.current_stock} @ £{Number(candidate?.cost_price ?? 0).toFixed(2)}</div></div>
            <div><span className="text-muted-foreground">Last sold</span><div className="font-semibold">{candidate?.last_sold ?? "never"}</div></div>
            <div><span className="text-muted-foreground">Capital tied</span><div className="font-semibold text-orange-400">£{Number(candidate?.capital_tied ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5"><Label>Discount %</Label><Input type="number" min={1} max={95} value={discount} onChange={e => setDiscount(e.target.value)} className="w-28" /></div>
            {isSale && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1"><Clock className="h-3 w-3" />Sale length (weeks)</Label>
                <Input type="number" min={1} max={52} value={weeks} onChange={e => setWeeks(e.target.value)} className="w-28" />
              </div>
            )}
            <p className="text-xs text-muted-foreground pb-2">{isSale ? `Reviews on ${weeks && Number(weeks) > 0 ? new Date(Date.now() + Number(weeks) * 7 * 86_400_000).toISOString().slice(0, 10) : "—"}.` : `Logistics floor ≈ £${LIQUIDATION_FLOOR.toFixed(2)} — below it the sale loses money on fees + courier.`} Applies off each listing's current price.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Listings ({allListings.length})</Label>
            {knownLoading ? <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="h-3 w-3 animate-spin" />Finding listings…</div> : (
              <div className="rounded-lg border border-border/60 divide-y divide-border/40 max-h-48 overflow-y-auto">
                {allListings.length === 0 && <div className="p-3 text-xs text-amber-400 flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5" /> No sales history — add store + current price below to push.</div>}
                {allListings.map((l, i) => {
                  const salePrice = sale(l.current);
                  const belowFloor = !isSale && salePrice < LIQUIDATION_FLOOR;
                  return (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="font-mono">{l.listing_sku}</span><span className="text-muted-foreground">{l.store_name}</span>
                      <span>£{l.current.toFixed(2)} <span className={`font-semibold ${belowFloor ? "text-destructive" : "text-orange-400"}`}>→ £{salePrice.toFixed(2)}{belowFloor && <span title={`Below the £${LIQUIDATION_FLOOR.toFixed(2)} logistics floor`}> ⚠</span>}</span></span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="space-y-2">
            {manual.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={m.store_id} onValueChange={v => setManual(arr => arr.map((x, j) => j === i ? { ...x, store_id: v } : x))}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Store" /></SelectTrigger>
                  <SelectContent>{stores.map(s => <SelectItem key={s.id} value={s.id}>{s.store_name}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="h-8 text-xs flex-1" placeholder="Listing SKU" value={m.listing_sku} onChange={e => setManual(arr => arr.map((x, j) => j === i ? { ...x, listing_sku: e.target.value } : x))} />
                <Input className="h-8 text-xs w-24" type="number" step="0.01" placeholder="Current £" value={m.current_price} onChange={e => setManual(arr => arr.map((x, j) => j === i ? { ...x, current_price: e.target.value } : x))} />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setManual(arr => arr.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setManual(arr => [...arr, { store_id: "", listing_sku: candidate?.sku ?? "", current_price: "" }])}><Plus className="h-3 w-3 mr-1" />Add listing manually</Button>
          </div>
          <div className="space-y-1.5"><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Why are we clearing this?" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={launch} disabled={saving || pct <= 0 || allListings.length === 0}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}Start &amp; push ({allListings.length})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Brands tab ─────────────────────────────────────────────────────
interface BrandRow { brand_name: string; total_candidates: number; capital_tied: number; dead_count: number; capital_under_clearance: number }
type BrandSort = "capital_tied" | "total_candidates" | "dead_count" | "capital_under_clearance" | "brand_name";

function BrandsTab({ maxVelocity, minCapital, setMaxVelocity, setMinCapital }: { maxVelocity: number; minCapital: number; setMaxVelocity: (n: number) => void; setMinCapital: (n: number) => void }) {
  const [sort, setSort] = useState<BrandSort>("capital_tied");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ["liquidation-by-brand", maxVelocity, minCapital],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_liquidation_by_brand", { max_velocity: maxVelocity, min_capital: minCapital });
      if (error) throw error;
      return data as BrandRow[];
    },
  });

  const sorted = useMemo(() => {
    const m = dir === "asc" ? 1 : -1;
    return [...brands].sort((a, b) => sort === "brand_name" ? m * a.brand_name.localeCompare(b.brand_name) : m * (Number(a[sort]) - Number(b[sort])));
  }, [brands, sort, dir]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5"><Label className="text-xs">Max velocity /wk</Label><Input type="number" step="0.1" value={maxVelocity} onChange={e => setMaxVelocity(Number(e.target.value))} className="w-28 h-9" /></div>
        <div className="space-y-1.5"><Label className="text-xs">Min capital £</Label><Input type="number" value={minCapital} onChange={e => setMinCapital(Number(e.target.value) || 0)} className="w-24 h-9" /></div>
        <div className="space-y-1.5 ml-auto">
          <Label className="text-xs">Sort by</Label>
          <Select value={sort} onValueChange={v => setSort(v as BrandSort)}>
            <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="capital_tied">Capital tied up</SelectItem>
              <SelectItem value="total_candidates">Total candidates</SelectItem>
              <SelectItem value="capital_under_clearance">Under active clearance</SelectItem>
              <SelectItem value="dead_count">Dead (never sold)</SelectItem>
              <SelectItem value="brand_name">Brand name</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={() => setDir(d => d === "asc" ? "desc" : "asc")}>
          <ArrowUpDown className="h-4 w-4 mr-1" />{dir === "asc" ? "Asc" : "Desc"}
        </Button>
      </div>

      {isLoading ? <PageLoader rows={6} columns={[160, 80, 100, 100, 80]} label="Loading brands" /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sorted.map(b => (
            <Card key={b.brand_name} className="hover:border-pd-accent/40 transition-colors">
              <CardContent className="pt-5">
                <div className="font-semibold text-base mb-3 truncate">{b.brand_name}</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><div className="text-xs text-muted-foreground">Candidates</div><div className="text-lg font-bold">{b.total_candidates.toLocaleString()}</div></div>
                  <div><div className="text-xs text-muted-foreground">Capital tied</div><div className="text-lg font-bold text-orange-400">£{Number(b.capital_tied).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
                  <div><div className="text-xs text-muted-foreground">Under clearance</div><div className="text-base font-semibold text-emerald-400">£{Number(b.capital_under_clearance).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
                  <div><div className="text-xs text-muted-foreground">Dead (never sold)</div><div className="text-base font-semibold text-destructive">{b.dead_count.toLocaleString()}</div></div>
                </div>
              </CardContent>
            </Card>
          ))}
          {sorted.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-8">No brands at these thresholds.</p>}
        </div>
      )}
    </div>
  );
}

// ── Graphs tab ─────────────────────────────────────────────────────
function GraphsTab() {
  const { data: snaps = [], isLoading } = useQuery({
    queryKey: ["liquidation-snapshots"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("liquidation_snapshots").select("*").order("snapshot_date", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((s: any) => ({
        date: s.snapshot_date,
        "Capital tied": Number(s.total_capital),
        "Under clearance": Number(s.capital_under_clearance),
        Candidates: Number(s.total_candidates),
        Dead: Number(s.dead_count),
      }));
    },
  });

  if (isLoading) return <PageLoader rows={4} columns={[100, 100, 100]} label="Loading trend" />;

  return (
    <div className="space-y-4">
      {snaps.length < 2 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-2 text-sm text-amber-400">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          The trend builds from a weekly snapshot (Sunday evenings). With {snaps.length} so far, the line fills in over the coming weeks — the goal is watching the pile shrink.
        </div>
      )}
      <Card>
        <CardHeader><CardTitle className="text-base">Capital tied up over time</CardTitle><CardDescription>Weekly snapshot — total dead-stock capital and the slice under active clearance.</CardDescription></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={snaps} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
              <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => `£${Number(v).toLocaleString()}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Capital tied" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={2} />
              <Line type="monotone" dataKey="Under clearance" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Candidate count over time</CardTitle><CardDescription>How many SKUs qualify as dead/slow stock each week.</CardDescription></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={snaps} margin={{ top: 10, right: 16, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Candidates" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="Dead" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, className = "", icon: Icon }: { label: string; value: string; className?: string; icon?: React.ElementType }) {
  return (<Card><CardContent className="pt-6"><div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">{Icon && <Icon className="h-3 w-3" />}{label}</div><div className={`text-2xl font-bold mt-1 ${className}`}>{value}</div></CardContent></Card>);
}
