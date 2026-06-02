import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ArrowLeft, Check, SkipForward, Trophy, Loader2, Boxes, CheckCircle2, AlertTriangle } from "lucide-react";

type Mode = "full" | "selected" | "number";
type Phase = "setup" | "playing" | "done";

interface Sku {
  id: string;
  sku: string;
  name: string | null;
  brand_id: string | null;
  brand_name: string | null;
  mintsoft_product_id: number | null;
}

interface BrandOption {
  id: string;
  name: string;
  qualifying_count: number;
}

interface SyncSummary {
  synced: number;
  flagged: number;
  failed: number;
}

const NUMBER_SIZES = [5, 10, 20];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function feedbackFor(counted: number, total: number): { title: string; sub: string } {
  if (total <= 0) return { title: "Round complete!", sub: "" };
  if (counted === total) return { title: "🏆 Clean sweep!", sub: "Every SKU counted — legend." };
  if (counted === 1) return { title: "👍 That's one more than before", sub: "Every count counts — one fewer un-counted SKU." };
  const pct = counted / total;
  if (pct >= 0.5) return { title: "🔥 Great round!", sub: "Strong throughput — keep the aisle moving." };
  if (counted > 0) return { title: "👏 Nice work", sub: "Every count helps — come back for another?" };
  return { title: "Nothing counted yet", sub: "Skipped them all — try a smaller set or a different brand." };
}

export default function StockCountGame() {
  const [desktop, setDesktop] = useState(false);
  const [phase, setPhase] = useState<Phase>("setup");

  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);

  const [brandSkus, setBrandSkus] = useState<Sku[]>([]);
  const [loadingSkus, setLoadingSkus] = useState(false);

  const [mode, setMode] = useState<Mode>("full");
  const [numberSize, setNumberSize] = useState(10);
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<string>>(new Set());

  const [queue, setQueue] = useState<Sku[]>([]);
  const [idx, setIdx] = useState(0);
  const [qty, setQty] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [counted, setCounted] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [capturedEventIds, setCapturedEventIds] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);

  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Load brand options on mount
  useEffect(() => {
    (async () => {
      setLoadingBrands(true);
      const { data, error } = await supabase.rpc("get_never_counted_brand_counts");
      if (error) {
        toast.error("Failed to load brands");
        setLoadingBrands(false);
        return;
      }
      const list: BrandOption[] = ((data as any[]) ?? []).map((r) => ({
        id: r.brand_id,
        name: r.brand_name,
        qualifying_count: Number(r.qualifying_count),
      }));
      setBrands(list);
      setLoadingBrands(false);
    })();
  }, []);

  // Focus input when desktop + playing
  useEffect(() => {
    if (phase === "playing" && desktop) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [phase, idx, desktop]);

  // Fire the background Mintsoft sync once we reach the end screen.
  useEffect(() => {
    if (phase !== "done" || capturedEventIds.length === 0) return;
    let cancelled = false;
    (async () => {
      setSyncState("syncing");
      try {
        const { data, error } = await supabase.functions.invoke("stocktake-sync", {
          body: { event_ids: capturedEventIds },
        });
        if (error) throw error;
        if (cancelled) return;
        setSyncSummary({
          synced: (data as any)?.synced ?? 0,
          flagged: (data as any)?.flagged ?? 0,
          failed: (data as any)?.failed ?? 0,
        });
        setSyncState("done");
      } catch {
        if (!cancelled) setSyncState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, capturedEventIds]);

  const selectBrand = async (brandId: string) => {
    setSelectedBrandId(brandId);
    setSelectedSkuIds(new Set());
    setLoadingSkus(true);
    const { data, error } = await supabase.rpc("get_never_counted_skus", {
      p_brand_id: brandId,
      p_limit: 1000,
    });
    if (error) {
      toast.error("Failed to load SKUs");
      setLoadingSkus(false);
      return;
    }
    const skus: Sku[] = ((data as any[]) ?? []).map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      brand_id: r.brand_id,
      brand_name: r.brand_name,
      mintsoft_product_id: r.mintsoft_product_id,
    }));
    setBrandSkus(skus);
    // Cap the Number option to what's available.
    const maxNumber = [...NUMBER_SIZES].reverse().find((n) => n <= skus.length) ?? NUMBER_SIZES[0];
    setNumberSize(maxNumber);
    setLoadingSkus(false);
  };

  const toggleSelected = (id: string) => {
    setSelectedSkuIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startGame = () => {
    if (!selectedBrandId) {
      toast.error("Pick a brand first");
      return;
    }
    let final: Sku[] = [];
    if (mode === "full") {
      final = [...brandSkus];
    } else if (mode === "number") {
      final = shuffle(brandSkus).slice(0, numberSize);
    } else {
      final = brandSkus.filter((s) => selectedSkuIds.has(s.id));
    }
    if (final.length === 0) {
      toast.info("No SKUs selected to count");
      return;
    }
    setQueue(final);
    setIdx(0);
    setQty("");
    setCounted(0);
    setSkipped(0);
    setCapturedEventIds([]);
    setSyncState("idle");
    setSyncSummary(null);
    setStartedAt(Date.now());
    setEndedAt(null);
    setPhase("playing");
  };

  const current = queue[idx];
  const progress = queue.length ? (idx / queue.length) * 100 : 0;

  const advance = () => {
    setQty("");
    if (idx + 1 >= queue.length) {
      setEndedAt(Date.now());
      setPhase("done");
    } else {
      setIdx((i) => i + 1);
    }
  };

  const skip = () => {
    setSkipped((s) => s + 1);
    advance();
  };

  const submit = async () => {
    if (!current) return;
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 0 || qty.trim() === "") {
      toast.error("Enter a whole number (0 or more)");
      return;
    }
    setSubmitting(true);
    try {
      // Durable capture — must not depend on Mintsoft being reachable.
      const { data, error } = await supabase.rpc("capture_stock_count", {
        p_sku: current.sku,
        p_qty: n,
      });
      if (error) throw error;
      if (data) setCapturedEventIds((ids) => [...ids, data as string]);
      setCounted((c) => c + 1);
      advance();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to capture count — try again");
    } finally {
      setSubmitting(false);
    }
  };

  const elapsedSec = useMemo(() => {
    if (!startedAt) return 0;
    const end = endedAt ?? Date.now();
    return Math.round((end - startedAt) / 1000);
  }, [startedAt, endedAt]);

  const reset = () => {
    setPhase("setup");
    setQueue([]);
    setIdx(0);
    setSelectedBrandId(null);
    setBrandSkus([]);
    setSelectedSkuIds(new Set());
    setMode("full");
    // Refresh brand counts — some SKUs just dropped out of the pool.
    supabase.rpc("get_never_counted_brand_counts").then(({ data }) => {
      const list: BrandOption[] = ((data as any[]) ?? []).map((r) => ({
        id: r.brand_id,
        name: r.brand_name,
        qualifying_count: Number(r.qualifying_count),
      }));
      setBrands(list);
    });
  };

  const containerWidth = desktop ? "max-w-3xl" : "max-w-md";

  const numberAvailable = (n: number) => n <= brandSkus.length;

  return (
    <div className={`mx-auto px-4 py-4 ${containerWidth} space-y-4`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link to="/games" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Games
        </Link>
        <div className="flex items-center gap-2">
          <Label htmlFor="desktop-toggle" className="text-xs text-muted-foreground">Desktop</Label>
          <Switch id="desktop-toggle" checked={desktop} onCheckedChange={setDesktop} />
        </div>
      </div>

      <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
        <Boxes className="h-5 w-5 text-pd-accent" />
        Stock Count Game
      </h1>

      {phase === "setup" && (
        <Card className="p-4 space-y-5">
          {/* Brand list */}
          <div className="space-y-2">
            <Label>Brand <span className="text-muted-foreground font-normal">— SKUs never counted</span></Label>
            {loadingBrands ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading brands…
              </div>
            ) : brands.length === 0 ? (
              <div className="text-sm text-muted-foreground">Nothing left to count 🎉</div>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {brands.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => selectBrand(b.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${
                      selectedBrandId === b.id ? "bg-pd-accent/10" : ""
                    }`}
                  >
                    <span className="text-sm font-medium text-foreground">{b.name}</span>
                    <Badge variant="secondary">{b.qualifying_count}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Mode + counting set — only once a brand is chosen */}
          {selectedBrandId && (
            <>
              {loadingSkus ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading SKUs…
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Mode</Label>
                    <div className="grid grid-cols-3 gap-2">
                      <Button variant={mode === "full" ? "default" : "outline"} onClick={() => setMode("full")} className="h-12">
                        Full
                      </Button>
                      <Button variant={mode === "selected" ? "default" : "outline"} onClick={() => setMode("selected")} className="h-12">
                        Select
                      </Button>
                      <Button variant={mode === "number" ? "default" : "outline"} onClick={() => setMode("number")} className="h-12">
                        Number
                      </Button>
                    </div>
                  </div>

                  {mode === "full" && (
                    <p className="text-sm text-muted-foreground">
                      Count all <span className="font-semibold text-foreground">{brandSkus.length}</span> qualifying SKUs.
                    </p>
                  )}

                  {mode === "number" && (
                    <div className="space-y-2">
                      <Label>How many (random)</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {NUMBER_SIZES.map((n) => (
                          <Button
                            key={n}
                            variant={numberSize === n ? "default" : "outline"}
                            onClick={() => setNumberSize(n)}
                            disabled={!numberAvailable(n)}
                            className="h-12"
                          >
                            {n}
                          </Button>
                        ))}
                      </div>
                      {!numberAvailable(20) && (
                        <p className="text-xs text-muted-foreground">Only {brandSkus.length} available for this brand.</p>
                      )}
                    </div>
                  )}

                  {mode === "selected" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Tick the SKUs to count</Label>
                        <span className="text-xs text-muted-foreground">{selectedSkuIds.size} selected</span>
                      </div>
                      <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
                        {brandSkus.map((s) => (
                          <label
                            key={s.id}
                            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50"
                          >
                            <Checkbox checked={selectedSkuIds.has(s.id)} onCheckedChange={() => toggleSelected(s.id)} />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground truncate">{s.sku}</div>
                              {s.name && <div className="text-xs text-muted-foreground truncate">{s.name}</div>}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button onClick={startGame} className="w-full h-14 text-base">
                    Start Counting
                  </Button>
                </>
              )}
            </>
          )}
        </Card>
      )}

      {phase === "playing" && current && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">SKU {idx + 1} of {queue.length}</span>
            <span className="text-muted-foreground">✅ {counted} &middot; ⏭ {skipped}</span>
          </div>
          <Progress value={progress} className="h-2" />

          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.18 }}
            >
              <Card className="p-5 space-y-3">
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {current.brand_name ?? "—"}
                  </div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-foreground break-all leading-tight">
                    {current.sku}
                  </div>
                  {current.name && (
                    <div className="text-sm text-muted-foreground leading-snug">{current.name}</div>
                  )}
                </div>

                <div className="space-y-2 pt-2">
                  <Label htmlFor="qty-input" className="text-sm">Units counted</Label>
                  <Input
                    id="qty-input"
                    ref={inputRef}
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="0"
                    placeholder="0"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submit();
                    }}
                    className="h-14 text-2xl font-semibold"
                    autoFocus={desktop}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button variant="secondary" onClick={skip} disabled={submitting} className="h-14">
                    <SkipForward className="h-4 w-4 mr-1" /> Skip
                  </Button>
                  <Button
                    onClick={submit}
                    disabled={submitting || qty.trim() === ""}
                    className="h-14 bg-green-600 hover:bg-green-700 text-white"
                  >
                    {submitting ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Check className="h-5 w-5 mr-1" /> Next
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {phase === "done" && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
          <Card className="p-6 text-center space-y-4">
            <div className="flex justify-center">
              <Trophy className="h-14 w-14 text-pd-accent" />
            </div>
            {(() => {
              const fb = feedbackFor(counted, queue.length);
              return (
                <>
                  <h2 className="text-2xl font-bold text-foreground">{fb.title}</h2>
                  {fb.sub && <p className="text-sm text-muted-foreground">{fb.sub}</p>}
                </>
              );
            })()}
            <p className="text-foreground text-lg">
              You counted <span className="font-bold text-pd-accent">{counted}</span> of {queue.length} SKUs
            </p>
            <div className="text-sm text-muted-foreground">
              Time: {Math.floor(elapsedSec / 60)}m {elapsedSec % 60}s &middot; Skipped: {skipped}
            </div>

            {/* Sync status */}
            {capturedEventIds.length > 0 && (
              <div className="rounded-md border border-border p-3 text-sm">
                {syncState === "syncing" && (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Syncing counts to Mintsoft…
                  </div>
                )}
                {syncState === "done" && syncSummary && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-center gap-2 text-green-600">
                      <CheckCircle2 className="h-4 w-4" /> {syncSummary.synced} synced to Mintsoft
                    </div>
                    {(syncSummary.flagged > 0 || syncSummary.failed > 0) && (
                      <div className="flex items-center justify-center gap-2 text-amber-600">
                        <AlertTriangle className="h-4 w-4" />
                        {syncSummary.flagged > 0 && <span>{syncSummary.flagged} flagged (real stock appeared)</span>}
                        {syncSummary.failed > 0 && <span>{syncSummary.failed} failed — will retry</span>}
                      </div>
                    )}
                  </div>
                )}
                {syncState === "error" && (
                  <div className="flex items-center justify-center gap-2 text-amber-600">
                    <AlertTriangle className="h-4 w-4" /> Counts saved — Mintsoft sync will retry later.
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-center pt-2">
              <Button variant="outline" onClick={() => (window.location.href = "/games")}>
                Back to Games
              </Button>
              <Button onClick={reset}>Play Again</Button>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
