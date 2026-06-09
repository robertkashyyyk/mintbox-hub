/**
 * Liquidation Candidates — Phase 1 of Price Campaigns.
 *
 * Surfaces slow/dead stock (low velocity + capital tied up) and lets a human
 * launch a "campaign" on a SKU: snapshots the original price + baseline metrics
 * so the repricer can later ring-fence it, we can measure if the sale is
 * working, and revert to the original price.
 *
 * Phase 1 is RECORD-ONLY — launching a campaign creates the record but does not
 * yet push a price to the channel (that's Phase 2 via the SFTP path).
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
import { Flame, Loader2, PoundSterling, Boxes, AlertTriangle, RotateCcw, CheckCircle2 } from "lucide-react";
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
  original_price: number | null; campaign_price: number | null;
  baseline_velocity: number | null; baseline_stock: number | null;
  start_date: string; notes: string | null;
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

  const endMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "ended" | "reverted" }) => {
      const { error } = await (supabase as any).from("price_campaigns")
        .update({ status, outcome: status === "reverted" ? "reverted" : null, end_date: new Date().toISOString().slice(0, 10) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campaign closed");
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
        description="Slow and dead stock tying up capital. Launch a clearance campaign to ring-fence a SKU from the repricer and track whether the sale shifts it."
        icon={Flame}
      />

      {/* Active campaigns */}
      {campaigns.length > 0 && (
        <Card className="border-orange-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" /> Active campaigns ({campaigns.length})
            </CardTitle>
            <CardDescription>These SKUs are ring-fenced — the repricer will leave them alone (Phase 3).</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Original</TableHead>
                    <TableHead className="text-right">Sale price</TableHead>
                    <TableHead className="text-right">Baseline velocity</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.sku}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs capitalize">{c.type}</Badge></TableCell>
                      <TableCell className="text-right text-sm">{c.original_price != null ? `£${Number(c.original_price).toFixed(2)}` : "—"}</TableCell>
                      <TableCell className="text-right text-sm font-semibold text-orange-400">{c.campaign_price != null ? `£${Number(c.campaign_price).toFixed(2)}` : "—"}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">{c.baseline_velocity != null ? `${Number(c.baseline_velocity).toFixed(2)}/wk` : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.start_date}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" title="End — keep the price as-is"
                            onClick={() => endMutation.mutate({ id: c.id, status: "ended" })}>
                            <CheckCircle2 className="h-3 w-3 mr-1" />End
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-amber-400" title="Revert to original price (Phase 2 will push it)"
                            onClick={() => endMutation.mutate({ id: c.id, status: "reverted" })}>
                            <RotateCcw className="h-3 w-3 mr-1" />Revert
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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Candidates" value={String(filtered.length)} icon={Boxes} />
        <Stat label="Capital tied up" value={`£${totalCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} className="text-orange-400" icon={PoundSterling} />
        <Stat label="Dead (no sales 90d)" value={String(filtered.filter(c => !c.units_sold_90d).length)} className="text-destructive" icon={AlertTriangle} />
      </div>

      {/* Candidates table */}
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
        Phase 1 — record-only: launching a sale snapshots the price + baseline but does not yet push to the channel.
        Pushing &amp; revert via the 3D/SFTP path comes in Phase 2; repricer ring-fence in Phase 3.
      </p>

      <LaunchDialog
        candidate={launch}
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

function LaunchDialog({ candidate, onClose, onLaunched }: { candidate: Candidate | null; onClose: () => void; onLaunched: () => void }) {
  const [salePrice, setSalePrice] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // reset on open
  useEffect(() => {
    if (candidate) { setSalePrice(""); setOriginalPrice(""); setNotes(""); }
  }, [candidate]);

  async function launch() {
    if (!candidate) return;
    if (!salePrice.trim()) { toast.error("Enter a sale price"); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from("price_campaigns").insert({
      sku: candidate.sku,
      type: "liquidation",
      status: "active",
      campaign_price: Number(salePrice),
      original_price: originalPrice.trim() ? Number(originalPrice) : null,
      baseline_velocity: candidate.velocity_per_week,
      baseline_stock: candidate.current_stock,
      baseline_cost: candidate.cost_price,
      notes: notes.trim() || null,
      created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.code === "23505" ? "This SKU already has an active campaign." : error.message);
      return;
    }
    toast.success(`${candidate.sku} — clearance campaign started`);
    onLaunched();
  }

  return (
    <Dialog open={!!candidate} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono">{candidate?.sku}</DialogTitle>
          <DialogDescription>Start a clearance campaign. Ring-fences the SKU from the repricer (Phase 3) and snapshots the baseline.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Stock / cost</span><span>{candidate?.current_stock} @ £{Number(candidate?.cost_price ?? 0).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Velocity (baseline)</span><span>{Number(candidate?.velocity_per_week ?? 0).toFixed(2)}/wk</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Capital tied</span><span className="text-orange-400 font-semibold">£{Number(candidate?.capital_tied ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Sale price (£) *</Label>
              <Input type="number" step="0.01" value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="e.g. 4.99" />
            </div>
            <div className="space-y-1.5">
              <Label>Original price (£)</Label>
              <Input type="number" step="0.01" value={originalPrice} onChange={e => setOriginalPrice(e.target.value)} placeholder="for revert" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Original price is the snapshot we'd revert to. Phase 2 will pull the live channel price automatically; for now enter it if you want a revert target.</p>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Why are we clearing this?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={launch} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Flame className="h-4 w-4 mr-2" />}
            Start clearance
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
