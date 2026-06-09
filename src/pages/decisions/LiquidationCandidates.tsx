/**
 * Liquidation Candidates — Price Campaigns Phase 2.
 *
 * Surfaces slow/dead stock and lets a human launch a clearance campaign:
 *   - snapshots per-listing original prices (revert target)
 *   - applies a discount % across every store/pack-size listing the SKU is in
 *   - pushes the sale prices to the channel via the proven 3D/SFTP path
 *   - revert pushes the originals back
 *
 * Dead SKUs (no sales history → no known price/store) get manual store+price
 * entry in the launch dialog so they can still be pushed.
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Flame, Loader2, PoundSterling, Boxes, AlertTriangle, RotateCcw, CheckCircle2, Plus, Trash2, Send } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { PageLoader } from "@/components/ui/PageLoader";

interface Candidate {
  sku: string; product_name: string | null; brand_name: string | null;
  current_stock: number; cost_price: number; velocity_per_week: number;
  units_sold_90d: number | null; weeks_of_cover: number | null; capital_tied: number;
  in_campaign: boolean;
}
interface Campaign {
  id: string; sku: string; type: string; status: string;
  original_price: number | null; campaign_price: number | null; discount_pct: number | null;
  baseline_velocity: number | null; baseline_stock: number | null;
  start_date: string; pushed_at: string | null; notes: string | null;
}
interface KnownListing { listing_sku: string; store_id: string; store_name: string; mintsoft_channel: string; current_price: number; last_sold: string }
interface Store { id: string; store_name: string }

// Group listing rows by store and push each store's batch via the SFTP path.
async function pushPerStore(rows: { store_id: string; listing_sku: string; price: number }[]) {
  const byStore = new Map<string, { sku: string; new_price: number }[]>();
  for (const r of rows) {
    if (!r.store_id) continue;
    if (!byStore.has(r.store_id)) byStore.set(r.store_id, []);
    byStore.get(r.store_id)!.push({ sku: r.listing_sku, new_price: r.price });
  }
  let pushed = 0, failed = 0;
  for (const [store_id, storeRows] of byStore) {
    const { error } = await supabase.functions.invoke("threeds-reprice-push", { body: { store_id, rows: storeRows } });
    if (error) { failed += storeRows.length; }
    else pushed += storeRows.length;
  }
  return { pushed, failed };
}

export default function LiquidationCandidates() {
  const qc = useQueryClient();
  const [maxVelocity, setMaxVelocity] = useState(0.5);
  const [minCapital, setMinCapital] = useState(25);
  const [brandFilter, setBrandFilter] = useState("all");
  const [launch, setLaunch] = useState<Candidate | null>(null);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["liquidation-candidates", maxVelocity, minCapital],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_liquidation_candidates", {
        max_velocity: maxVelocity, min_capital: minCapital, limit_n: 200,
      });
      if (error) throw error;
      return data as Candidate[];
    },
  });

  const { data: campaigns = [] } = useQuery({
    queryKey: ["price-campaigns-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("price_campaigns").select("*").eq("status", "active").order("start_date", { ascending: false });
      if (error) throw error;
      return data as Campaign[];
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

  // Revert: push each listing's original price back, then mark reverted.
  const revertMutation = useMutation({
    mutationFn: async (campaign: Campaign) => {
      const { data: listings } = await (supabase as any)
        .from("price_campaign_listings").select("listing_sku, store_id, original_price").eq("campaign_id", campaign.id);
      const rows = (listings ?? []).filter((l: any) => l.store_id && l.original_price != null)
        .map((l: any) => ({ store_id: l.store_id, listing_sku: l.listing_sku, price: Number(l.original_price) }));
      let res = { pushed: 0, failed: 0 };
      if (rows.length) res = await pushPerStore(rows);
      await (supabase as any).from("price_campaigns")
        .update({ status: "reverted", outcome: "reverted", reverted_at: new Date().toISOString(), end_date: new Date().toISOString().slice(0, 10) })
        .eq("id", campaign.id);
      await (supabase as any).from("price_campaign_listings").update({ reverted_at: new Date().toISOString() }).eq("campaign_id", campaign.id);
      return res;
    },
    onSuccess: (res) => {
      toast.success(`Reverted — ${res.pushed} listing price(s) pushed back${res.failed ? `, ${res.failed} failed` : ""}`);
      qc.invalidateQueries({ queryKey: ["price-campaigns-active"] });
      qc.invalidateQueries({ queryKey: ["liquidation-candidates"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const endMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("price_campaigns")
        .update({ status: "ended", end_date: new Date().toISOString().slice(0, 10) }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campaign ended (price left as-is)");
      qc.invalidateQueries({ queryKey: ["price-campaigns-active"] });
      qc.invalidateQueries({ queryKey: ["liquidation-candidates"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const brandOptions = useMemo(
    () => Array.from(new Set(candidates.map(c => c.brand_name).filter(Boolean) as string[])).sort(),
    [candidates]);
  const filtered = useMemo(
    () => candidates.filter(c => brandFilter === "all" || c.brand_name === brandFilter),
    [candidates, brandFilter]);
  const totalCapital = filtered.reduce((a, c) => a + Number(c.capital_tied), 0);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Liquidation Candidates"
        description="Slow and dead stock tying up capital. Launch a clearance to ring-fence a SKU from the repricer, push a discounted price, and track whether it shifts."
        icon={Flame}
      />

      {/* Active campaigns */}
      {campaigns.length > 0 && (
        <Card className="border-orange-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" /> Active campaigns ({campaigns.length})
            </CardTitle>
            <CardDescription>Ring-fenced — excluded from the repricer. Revert pushes the original prices back.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Orig → Sale (base)</TableHead>
                    <TableHead className="text-right">Baseline velocity</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Pushed</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.sku}</TableCell>
                      <TableCell className="text-right text-sm">{c.discount_pct != null ? `${c.discount_pct}%` : "—"}</TableCell>
                      <TableCell className="text-right text-sm">
                        {c.original_price != null ? `£${Number(c.original_price).toFixed(2)}` : "—"}
                        <span className="text-orange-400"> → {c.campaign_price != null ? `£${Number(c.campaign_price).toFixed(2)}` : "—"}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{c.baseline_velocity != null ? `${Number(c.baseline_velocity).toFixed(2)}/wk` : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.start_date}</TableCell>
                      <TableCell className="text-xs">{c.pushed_at ? <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 text-xs">Pushed</Badge> : <Badge variant="outline" className="text-xs">Record only</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" title="End — keep the sale price live" onClick={() => endMutation.mutate(c.id)}>
                            <CheckCircle2 className="h-3 w-3 mr-1" />End
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-amber-400" title="Revert — push original prices back" onClick={() => revertMutation.mutate(c)} disabled={revertMutation.isPending}>
                            {revertMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RotateCcw className="h-3 w-3 mr-1" />Revert</>}
                          </Button>
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

      {/* Filters */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Brand</Label>
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All brands</SelectItem>
                {brandOptions.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Max velocity (units/wk)</Label>
            <Input type="number" step="0.1" value={maxVelocity} onChange={e => setMaxVelocity(Number(e.target.value))} className="w-32 h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Min capital tied (£)</Label>
            <Input type="number" value={minCapital} onChange={e => setMinCapital(Number(e.target.value) || 0)} className="w-28 h-9" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Candidates" value={String(filtered.length)} icon={Boxes} />
        <Stat label="Capital tied up" value={`£${totalCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} className="text-orange-400" icon={PoundSterling} />
        <Stat label="Dead (no sales 90d)" value={String(filtered.filter(c => !c.units_sold_90d).length)} className="text-destructive" icon={AlertTriangle} />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <PageLoader rows={10} columns={[120, 200, 80, 70, 70, 90, 100, 90]} label="Loading candidates" /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Sold 90d</TableHead>
                    <TableHead className="text-right">Cover</TableHead>
                    <TableHead className="text-right">Capital tied</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No candidates at these thresholds.</TableCell></TableRow>
                  )}
                  {filtered.map(c => (
                    <TableRow key={c.sku}>
                      <TableCell><Link to={`/discovery/products?search=${encodeURIComponent(c.sku)}`} className="font-mono text-xs text-pd-accent hover:underline">{c.sku}</Link></TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{c.product_name ?? "—"}</TableCell>
                      <TableCell>{c.brand_name ? <Badge variant="outline" className="bg-primary/10 text-primary text-xs">{c.brand_name}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right text-sm">{c.current_stock}</TableCell>
                      <TableCell className="text-right text-sm">£{Number(c.cost_price).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm">{c.units_sold_90d ?? <span className="text-destructive font-medium">0</span>}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {c.weeks_of_cover != null ? `${c.weeks_of_cover >= 999 ? "999+" : c.weeks_of_cover}w` : <span className="text-destructive">dead</span>}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-orange-400">£{Number(c.capital_tied).toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLaunch(c)}>
                          <Flame className="h-3 w-3 mr-1" />Sale
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground pb-4">
        Discount applies proportionally across every store + pack-size listing. Sale prices push via the 3D/SFTP path; Revert restores the snapshotted originals.
        Repricer ring-fence (so it won't undo a sale) lands in Phase 3.
      </p>

      <LaunchDialog
        candidate={launch} stores={stores}
        onClose={() => setLaunch(null)}
        onLaunched={() => {
          setLaunch(null);
          qc.invalidateQueries({ queryKey: ["price-campaigns-active"] });
          qc.invalidateQueries({ queryKey: ["liquidation-candidates"] });
        }}
      />
    </div>
  );
}

function LaunchDialog({ candidate, stores, onClose, onLaunched }: { candidate: Candidate | null; stores: Store[]; onClose: () => void; onLaunched: () => void }) {
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [manual, setManual] = useState<{ store_id: string; listing_sku: string; current_price: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: known = [], isLoading: knownLoading } = useQuery({
    queryKey: ["campaign-listings", candidate?.sku],
    enabled: !!candidate,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_campaign_listings_for_sku", { p_base_sku: candidate!.sku });
      if (error) throw error;
      return data as KnownListing[];
    },
  });

  useEffect(() => {
    if (candidate) { setDiscount(""); setNotes(""); setManual([]); }
  }, [candidate]);

  const pct = Number(discount) || 0;
  const sale = (cur: number) => Math.max(0, Number((cur * (1 - pct / 100)).toFixed(2)));

  // Combined listings to push
  const allListings = useMemo(() => {
    const k = known.map(l => ({ store_id: l.store_id, listing_sku: l.listing_sku, store_name: l.store_name, current: l.current_price }));
    const m = manual.filter(x => x.store_id && x.listing_sku && x.current_price)
      .map(x => ({ store_id: x.store_id, listing_sku: x.listing_sku, store_name: stores.find(s => s.id === x.store_id)?.store_name ?? "?", current: Number(x.current_price) }));
    return [...k, ...m];
  }, [known, manual, stores]);

  async function launch() {
    if (!candidate) return;
    if (pct <= 0) { toast.error("Enter a discount %"); return; }
    if (allListings.length === 0) { toast.error("No listings to discount — add one manually for a dead SKU"); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // representative base = the cheapest listing (likely the single)
      const base = [...allListings].sort((a, b) => a.current - b.current)[0];
      const { data: camp, error: cErr } = await (supabase as any).from("price_campaigns").insert({
        sku: candidate.sku, type: "liquidation", status: "active",
        discount_pct: pct,
        original_price: base.current, campaign_price: sale(base.current),
        baseline_velocity: candidate.velocity_per_week, baseline_stock: candidate.current_stock, baseline_cost: candidate.cost_price,
        notes: notes.trim() || null, created_by: user?.id ?? null,
      }).select("id").single();
      if (cErr) throw new Error(cErr.code === "23505" ? "This SKU already has an active campaign." : cErr.message);

      const childRows = allListings.map(l => ({
        campaign_id: camp.id, listing_sku: l.listing_sku, store_id: l.store_id, store_name: l.store_name,
        original_price: l.current, sale_price: sale(l.current),
      }));
      await (supabase as any).from("price_campaign_listings").insert(childRows);

      const res = await pushPerStore(allListings.map(l => ({ store_id: l.store_id, listing_sku: l.listing_sku, price: sale(l.current) })));
      await (supabase as any).from("price_campaigns").update({ pushed_at: new Date().toISOString() }).eq("id", camp.id);

      toast.success(`${candidate.sku} — ${pct}% off, ${res.pushed} listing(s) pushed${res.failed ? `, ${res.failed} failed` : ""}`);
      onLaunched();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!candidate} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{candidate?.sku}</DialogTitle>
          <DialogDescription>Clearance — discount % applies to every store + pack-size listing, then pushes via SFTP.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-xs grid grid-cols-3 gap-2">
            <div><span className="text-muted-foreground">Stock</span><div className="font-semibold">{candidate?.current_stock} @ £{Number(candidate?.cost_price ?? 0).toFixed(2)}</div></div>
            <div><span className="text-muted-foreground">Velocity</span><div className="font-semibold">{Number(candidate?.velocity_per_week ?? 0).toFixed(2)}/wk</div></div>
            <div><span className="text-muted-foreground">Capital tied</span><div className="font-semibold text-orange-400">£{Number(candidate?.capital_tied ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
          </div>

          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label>Discount %</Label>
              <Input type="number" min={1} max={95} value={discount} onChange={e => setDiscount(e.target.value)} placeholder="e.g. 30" className="w-28" />
            </div>
            <p className="text-xs text-muted-foreground pb-2">Applied off each listing's current price (scales across pack sizes).</p>
          </div>

          {/* Listings preview */}
          <div className="space-y-1.5">
            <Label className="text-xs">Listings ({allListings.length})</Label>
            {knownLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="h-3 w-3 animate-spin" />Finding listings…</div>
            ) : (
              <div className="rounded-lg border border-border/60 divide-y divide-border/40 max-h-48 overflow-y-auto">
                {allListings.length === 0 && (
                  <div className="p-3 text-xs text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5" /> No sales history — add the store + current price manually below to push.
                  </div>
                )}
                {allListings.map((l, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="font-mono">{l.listing_sku}</span>
                    <span className="text-muted-foreground">{l.store_name}</span>
                    <span>£{l.current.toFixed(2)} <span className="text-orange-400 font-semibold">→ £{sale(l.current).toFixed(2)}</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Manual add (for dead SKUs) */}
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
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setManual(arr => [...arr, { store_id: "", listing_sku: candidate?.sku ?? "", current_price: "" }])}>
              <Plus className="h-3 w-3 mr-1" />Add listing manually
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Why are we clearing this?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={launch} disabled={saving || pct <= 0 || allListings.length === 0}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Start &amp; push ({allListings.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, className = "", icon: Icon }: { label: string; value: string; className?: string; icon?: React.ElementType }) {
  return (
    <Card><CardContent className="pt-6">
      <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className={`text-2xl font-bold mt-1 ${className}`}>{value}</div>
    </CardContent></Card>
  );
}
