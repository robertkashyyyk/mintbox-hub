/**
 * Remeasure Game — mobile-first flow for packers to re-measure SKUs
 * flagged by carrier penalties and record correct dimensions.
 *
 * Flow:
 *   Setup  → pick brand → pick batch size → optional print list
 *   Playing → one SKU at a time: enter L/W/H/weight → save → next
 *   Done   → motivational summary
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  ArrowLeft, Check, SkipForward, Trophy, Loader2,
  Ruler, Printer, ChevronRight, Package,
} from "lucide-react";

type Phase = "setup" | "playing" | "done";

interface BrandOption {
  brand_id: string;
  brand_name: string;
  open_count: number;
  total_cost: number;
}

interface RemeasureTask {
  id: string;
  sku: string;
  penalty_id: string | null;
  mintsoft_order_id: number | null;
  carrier_penalties: {
    tracking_number: string | null;
    declared_format: string | null;
    actual_format: string | null;
    reason_code: string | null;
    penalty_amount: number;
  } | null;
}

const BATCH_SIZES = [5, 10, 20] as const;

function feedbackFor(done: number, total: number) {
  if (done === 0) return { title: "Nothing measured yet", sub: "Give it another go — pick a smaller batch?" };
  if (done === total) return { title: "🏆 Complete sweep!", sub: "Every SKU measured — outstanding work." };
  const pct = done / total;
  if (pct >= 0.8) return { title: "🔥 Almost perfect!", sub: "Strong round — just a few left." };
  if (pct >= 0.5) return { title: "👏 Solid effort!", sub: "Over halfway — come back for the rest?" };
  return { title: "👍 Good start", sub: "Every remeasure helps — even one fewer penalty." };
}

export default function RemeasureGame() {
  const [phase, setPhase] = useState<Phase>("setup");

  // Setup state
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState<number | "all">(10);

  // Queue
  const [queue, setQueue] = useState<RemeasureTask[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [idx, setIdx] = useState(0);

  // Per-SKU inputs
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [measured, setMeasured] = useState(0);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const selectedBrand = brands.find(b => b.brand_id === selectedBrandId);

  // Load brands on mount
  useEffect(() => {
    (async () => {
      setLoadingBrands(true);
      const { data, error } = await (supabase as any).rpc("get_remeasure_brand_counts");
      if (error) { toast.error("Failed to load brands"); setLoadingBrands(false); return; }
      setBrands((data as BrandOption[]) ?? []);
      setLoadingBrands(false);
    })();
  }, []);

  // Focus first input when a new SKU appears
  useEffect(() => {
    if (phase === "playing") {
      setTimeout(() => firstInputRef.current?.focus(), 80);
    }
  }, [phase, idx]);

  async function startGame() {
    if (!selectedBrandId) { toast.error("Pick a brand first"); return; }
    setLoadingQueue(true);

    // Fetch open tasks for this brand
    const { data: tasks, error } = await supabase
      .from("carrier_remeasure_tasks")
      .select(`
        id, sku, penalty_id, mintsoft_order_id,
        carrier_penalties(tracking_number, declared_format, actual_format, reason_code, penalty_amount)
      `)
      .not("status", "in", '("completed","packer_issue")')
      .order("created_at", { ascending: true }) as any;

    if (error) { toast.error(error.message); setLoadingQueue(false); return; }

    // Filter to selected brand by checking products_cache
    const { data: brandSkus } = await supabase
      .from("products_cache")
      .select("sku")
      .eq("brand_id", selectedBrandId) as any;

    const skuSet = new Set((brandSkus ?? []).map((p: any) => p.sku));
    const filtered = (tasks ?? []).filter((t: RemeasureTask) => skuSet.has(t.sku));

    const limit = batchSize === "all" ? filtered.length : Math.min(batchSize, filtered.length);
    const queue = filtered.slice(0, limit);

    if (queue.length === 0) {
      toast.info("No open tasks for this brand");
      setLoadingQueue(false);
      return;
    }

    setQueue(queue);
    setIdx(0);
    setMeasured(0);
    setSkipped(0);
    clearInputs();
    setPhase("playing");
    setLoadingQueue(false);
  }

  function clearInputs() {
    setLength(""); setWidth(""); setHeight(""); setWeight("");
  }

  async function saveAndNext() {
    const task = queue[idx];
    if (!task) return;

    const dims: Record<string, number> = {};
    if (length) dims.length = Number(length);
    if (width) dims.width = Number(width);
    if (height) dims.height = Number(height);
    if (weight) dims.weight = Number(weight);

    if (Object.keys(dims).length === 0) {
      toast.error("Enter at least one measurement");
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("carrier_remeasure_tasks")
      .update({
        new_dimensions: dims,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    if (task.penalty_id) {
      await supabase
        .from("carrier_penalties")
        .update({ resolution_status: "remeasured", resolved_at: new Date().toISOString() })
        .eq("id", task.penalty_id);
    }

    setSaving(false);
    if (error) { toast.error(error.message); return; }

    setMeasured(m => m + 1);
    advance();
  }

  function skipAndNext() {
    setSkipped(s => s + 1);
    advance();
  }

  function advance() {
    clearInputs();
    if (idx + 1 >= queue.length) {
      setPhase("done");
    } else {
      setIdx(i => i + 1);
    }
  }

  function restart() {
    setPhase("setup");
    setQueue([]);
    setIdx(0);
    setBatchSize(10);
    clearInputs();
  }

  const task = queue[idx];
  const progress = queue.length > 0 ? Math.round((idx / queue.length) * 100) : 0;
  const { title: feedbackTitle, sub: feedbackSub } = feedbackFor(measured, queue.length);

  // ── PRINT LIST ──────────────────────────────────────────────────────────────
  function printList() {
    if (!selectedBrandId || !selectedBrand) return;
    const skusToFetch = brands.find(b => b.brand_id === selectedBrandId);
    // Build a simple print window from the brand's open tasks
    supabase
      .from("carrier_remeasure_tasks")
      .select("sku, carrier_penalties(declared_format, actual_format, reason_code)")
      .not("status", "in", '("completed","packer_issue")')
      .order("sku") as any;

    // Open a minimal print page
    const win = window.open("", "_blank", "width=800,height=600");
    if (!win) return;
    win.document.write(`
      <html><head><title>Remeasure List — ${selectedBrand.brand_name}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; }
        h1 { font-size: 16px; margin-bottom: 4px; }
        p { color: #666; margin-bottom: 16px; font-size: 11px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; border-bottom: 2px solid #000; padding: 4px 8px; font-size: 11px; }
        td { border-bottom: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
        .sku { font-weight: bold; font-family: monospace; }
        .dims { width: 80px; border-bottom: 1px solid #999; display: inline-block; }
        .row-space { height: 8px; }
        @media print { button { display: none; } }
      </style></head><body>
      <button onclick="window.print()" style="margin-bottom:16px;padding:6px 12px;">Print</button>
      <h1>Remeasure Queue — ${selectedBrand.brand_name}</h1>
      <p>Printed ${new Date().toLocaleString("en-GB")} · ${selectedBrand.open_count} open tasks</p>
      <table>
        <thead><tr>
          <th>SKU</th><th>Declared → Actual</th>
          <th>L (cm)</th><th>W (cm)</th><th>H (cm)</th><th>Weight (g)</th><th>Notes</th>
        </tr></thead>
        <tbody>
          ${queue.length > 0
            ? queue.map(t => `
              <tr>
                <td class="sku">${t.sku}</td>
                <td style="font-size:10px;color:#666">${t.carrier_penalties?.declared_format ?? "?"} → ${t.carrier_penalties?.actual_format ?? "?"}</td>
                <td><span class="dims">&nbsp;</span></td>
                <td><span class="dims">&nbsp;</span></td>
                <td><span class="dims">&nbsp;</span></td>
                <td><span class="dims">&nbsp;</span></td>
                <td></td>
              </tr>`).join("")
            : `<tr><td colspan="7" style="color:#999;padding:20px 8px;">Load a batch first to populate this list</td></tr>`
          }
        </tbody>
      </table>
      </body></html>
    `);
    win.document.close();
  }

  // ── SETUP SCREEN ────────────────────────────────────────────────────────────
  if (phase === "setup") {
    return (
      <div className="min-h-screen bg-background p-4 space-y-6 max-w-lg mx-auto">
        <div className="flex items-center gap-3 pt-2">
          <Link to="/operations/carriers/remeasure">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Remeasure</h1>
            <p className="text-sm text-muted-foreground">Pick a brand and get started</p>
          </div>
        </div>

        {/* Brand picker */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Brand</Label>
          {loadingBrands ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading brands…</span>
            </div>
          ) : brands.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No open remeasure tasks found.</p>
          ) : (
            <div className="space-y-2">
              {brands.map(b => (
                <button
                  key={b.brand_id}
                  onClick={() => setSelectedBrandId(b.brand_id)}
                  className={`w-full text-left rounded-xl border p-4 transition-colors ${
                    selectedBrandId === b.brand_id
                      ? "border-pd-accent bg-pd-accent/10"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{b.brand_name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/30">
                        {b.open_count} open
                      </Badge>
                      {selectedBrandId === b.brand_id && (
                        <Check className="h-4 w-4 text-pd-accent" />
                      )}
                    </div>
                  </div>
                  {b.total_cost > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      £{Number(b.total_cost).toFixed(2)} in penalties
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Batch size */}
        {selectedBrandId && (
          <div className="space-y-2">
            <Label className="text-sm font-medium text-muted-foreground uppercase tracking-wide">How many?</Label>
            <div className="grid grid-cols-4 gap-2">
              {BATCH_SIZES.map(n => (
                <button
                  key={n}
                  onClick={() => setBatchSize(n)}
                  disabled={n > (selectedBrand?.open_count ?? 0)}
                  className={`rounded-xl border p-3 text-center font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                    batchSize === n ? "border-pd-accent bg-pd-accent/10 text-pd-accent" : "border-border hover:bg-muted/40"
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => setBatchSize("all")}
                className={`rounded-xl border p-3 text-center font-bold transition-colors ${
                  batchSize === "all" ? "border-pd-accent bg-pd-accent/10 text-pd-accent" : "border-border hover:bg-muted/40"
                }`}
              >
                ALL
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedBrand?.open_count ?? 0} open tasks for {selectedBrand?.brand_name}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2 pt-2">
          <Button
            className="w-full h-12 text-base"
            disabled={!selectedBrandId || loadingQueue}
            onClick={startGame}
          >
            {loadingQueue
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…</>
              : <><Ruler className="h-5 w-5 mr-2" />Start remeasuring</>
            }
          </Button>
          {selectedBrandId && (
            <Button variant="outline" className="w-full" onClick={printList}>
              <Printer className="h-4 w-4 mr-2" />Print collection list
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── DONE SCREEN ─────────────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto space-y-6">
        <div className="text-6xl">{measured === queue.length ? "🏆" : measured > 0 ? "✅" : "🤷"}</div>
        <div>
          <h1 className="text-2xl font-bold">{feedbackTitle}</h1>
          <p className="text-muted-foreground mt-1">{feedbackSub}</p>
        </div>
        <div className="w-full rounded-xl border border-border bg-muted/30 p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Measured</span>
            <span className="font-bold text-emerald-400">{measured}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Skipped</span>
            <span className="font-semibold">{skipped}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Brand</span>
            <span className="font-semibold">{selectedBrand?.brand_name}</span>
          </div>
        </div>
        <div className="w-full space-y-2">
          <Button className="w-full" onClick={restart}>
            <Ruler className="h-4 w-4 mr-2" />Another round
          </Button>
          <Link to="/operations/carriers/remeasure" className="block">
            <Button variant="outline" className="w-full">Back to queue</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── PLAYING SCREEN ──────────────────────────────────────────────────────────
  if (!task) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => setPhase("done")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{selectedBrand?.brand_name}</span>
            <span className="text-sm text-muted-foreground">{idx + 1} / {queue.length}</span>
          </div>
          <Progress value={progress} className="h-1.5 mt-1" />
        </div>
      </div>

      {/* SKU card */}
      <div className="flex-1 p-4 space-y-5">
        <Card className="border-pd-accent/30 bg-pd-accent/5">
          <CardContent className="pt-5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">SKU</p>
                <p className="text-2xl font-bold font-mono tracking-tight">{task.sku}</p>
              </div>
              <Package className="h-8 w-8 text-pd-accent/50 flex-shrink-0 mt-1" />
            </div>

            {(task.carrier_penalties?.declared_format || task.carrier_penalties?.actual_format) && (
              <div className="rounded-lg bg-background/60 border border-border/50 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Declared</span>
                  <span className="font-mono text-xs">{task.carrier_penalties?.declared_format ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Carrier measured</span>
                  <span className="font-mono text-xs text-destructive">{task.carrier_penalties?.actual_format ?? "—"}</span>
                </div>
                {task.carrier_penalties?.penalty_amount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Penalty</span>
                    <span className="font-mono text-xs font-semibold">
                      £{Number(task.carrier_penalties.penalty_amount).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Measurements */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">New measurements</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rm-l" className="text-sm">Length (cm)</Label>
              <Input
                id="rm-l"
                ref={firstInputRef}
                inputMode="decimal"
                placeholder="0.0"
                value={length}
                onChange={e => setLength(e.target.value)}
                className="h-12 text-lg text-center"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rm-w" className="text-sm">Width (cm)</Label>
              <Input
                id="rm-w"
                inputMode="decimal"
                placeholder="0.0"
                value={width}
                onChange={e => setWidth(e.target.value)}
                className="h-12 text-lg text-center"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rm-h" className="text-sm">Height (cm)</Label>
              <Input
                id="rm-h"
                inputMode="decimal"
                placeholder="0.0"
                value={height}
                onChange={e => setHeight(e.target.value)}
                className="h-12 text-lg text-center"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rm-wt" className="text-sm">Weight (g)</Label>
              <Input
                id="rm-wt"
                inputMode="decimal"
                placeholder="0"
                value={weight}
                onChange={e => setWeight(e.target.value)}
                className="h-12 text-lg text-center"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="p-4 border-t border-border space-y-2 bg-background">
        <Button
          className="w-full h-14 text-base"
          onClick={saveAndNext}
          disabled={saving || (!length && !width && !height && !weight)}
        >
          {saving
            ? <Loader2 className="h-5 w-5 animate-spin" />
            : <><Check className="h-5 w-5 mr-2" />Save & next</>
          }
        </Button>
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={skipAndNext}
          disabled={saving}
        >
          <SkipForward className="h-4 w-4 mr-2" />Skip this one
        </Button>
      </div>
    </div>
  );
}
