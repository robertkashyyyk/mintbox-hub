import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ArrowLeft, Check, SkipForward, Trophy, Loader2, PoundSterling } from "lucide-react";

type Mode = "brand" | "top_sellers";
type Phase = "setup" | "playing" | "done";

interface Sku {
  id: string;
  sku: string;
  name: string | null;
  brand_id: string | null;
  brand_name?: string | null;
  mintsoft_product_id: number | null;
}

interface BrandOption {
  id: string;
  name: string;
  missing_count: number;
}

const ROUND_SIZES = [5, 10, 20, 50];

export default function MissingCostsGame() {
  const [desktop, setDesktop] = useState(false);
  const [phase, setPhase] = useState<Phase>("setup");
  const [mode, setMode] = useState<Mode>("brand");
  const [roundSize, setRoundSize] = useState(10);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [queue, setQueue] = useState<Sku[]>([]);
  const [idx, setIdx] = useState(0);
  const [cost, setCost] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [priced, setPriced] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load brand options on mount
  useEffect(() => {
    (async () => {
      setLoadingBrands(true);
      const { data, error } = await supabase
        .from("products_cache")
        .select("brand_id, brands!inner(id,name)")
        .is("cost_price", null)
        .eq("discontinued", false)
        .eq("quarantined", false)
        .not("brand_id", "is", null)
        .limit(5000);
      if (error) {
        toast.error("Failed to load brands");
        setLoadingBrands(false);
        return;
      }
      const counts = new Map<string, { name: string; count: number }>();
      for (const row of (data as any[]) ?? []) {
        const b = row.brands;
        if (!b) continue;
        const prev = counts.get(b.id);
        if (prev) prev.count += 1;
        else counts.set(b.id, { name: b.name, count: 1 });
      }
      const list: BrandOption[] = Array.from(counts.entries())
        .map(([id, v]) => ({ id, name: v.name, missing_count: v.count }))
        .sort((a, b) => b.missing_count - a.missing_count);
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

  const current = queue[idx];
  const progress = queue.length ? ((idx) / queue.length) * 100 : 0;

  const startGame = async () => {
    if (mode === "brand" && !selectedBrandId) {
      toast.error("Pick a brand first");
      return;
    }
    setLoadingBrands(true);
    try {
      let skus: Sku[] = [];
      if (mode === "brand") {
        const { data, error } = await supabase
          .from("products_cache")
          .select("id, sku, name, brand_id, mintsoft_product_id, brands(name)")
          .is("cost_price", null)
          .eq("discontinued", false)
          .eq("quarantined", false)
          .eq("brand_id", selectedBrandId!)
          .not("mintsoft_product_id", "is", null)
          .limit(roundSize);
        if (error) throw error;
        skus = ((data as any[]) ?? []).map((r) => ({
          id: r.id,
          sku: r.sku,
          name: r.name,
          brand_id: r.brand_id,
          brand_name: r.brands?.name ?? null,
          mintsoft_product_id: r.mintsoft_product_id,
        }));
      } else {
        // Top sellers: order_line_economics last 28 days, missing_cost=true
        const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from("order_line_economics")
          .select("sku, qty")
          .eq("missing_cost", true)
          .gte("order_date", since);
        if (error) throw error;
        const totals = new Map<string, number>();
        for (const r of (data as any[]) ?? []) {
          totals.set(r.sku, (totals.get(r.sku) ?? 0) + Number(r.qty ?? 0));
        }
        const topSkus = Array.from(totals.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, roundSize)
          .map(([sku]) => sku);
        if (topSkus.length === 0) {
          toast.info("No top sellers with missing costs in the last 28 days");
          setLoadingBrands(false);
          return;
        }
        const { data: prod, error: pErr } = await supabase
          .from("products_cache")
          .select("id, sku, name, brand_id, mintsoft_product_id, brands(name)")
          .in("sku", topSkus)
          .is("cost_price", null)
          .eq("discontinued", false)
          .eq("quarantined", false)
          .not("mintsoft_product_id", "is", null);
        if (pErr) throw pErr;
        const bySku = new Map<string, Sku>();
        for (const r of (prod as any[]) ?? []) {
          bySku.set(r.sku, {
            id: r.id,
            sku: r.sku,
            name: r.name,
            brand_id: r.brand_id,
            brand_name: r.brands?.name ?? null,
            mintsoft_product_id: r.mintsoft_product_id,
          });
        }
        skus = topSkus.map((s) => bySku.get(s)).filter(Boolean) as Sku[];
      }

      if (skus.length === 0) {
        toast.info("No matching SKUs to play with");
        setLoadingBrands(false);
        return;
      }

      setQueue(skus);
      setIdx(0);
      setCost("");
      setPriced(0);
      setSkipped(0);
      setStartedAt(Date.now());
      setEndedAt(null);
      setPhase("playing");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to start");
    } finally {
      setLoadingBrands(false);
    }
  };

  const advance = (didPrice: boolean) => {
    if (didPrice) setPriced((p) => p + 1);
    else setSkipped((s) => s + 1);
    setCost("");
    if (idx + 1 >= queue.length) {
      setEndedAt(Date.now());
      setPhase("done");
    } else {
      setIdx((i) => i + 1);
    }
  };

  const submit = async () => {
    if (!current) return;
    const n = Number(cost);
    if (!Number.isFinite(n) || n <= 0 || n > 100000) {
      toast.error("Enter a valid cost (£0.01 – £100,000)");
      return;
    }
    if (!current.mintsoft_product_id) {
      toast.error("Missing Mintsoft ID — skipping");
      advance(false);
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("update-product-cost", {
        body: {
          items: [
            {
              mintsoft_product_id: current.mintsoft_product_id,
              sku: current.sku,
              cost_price: n,
            },
          ],
        },
      });
      if (error) throw error;
      const res = (data as any)?.results?.[0];
      if (res && res.ok === false) throw new Error(res.error ?? "Update failed");
      toast.success(`Saved £${n.toFixed(2)}`);
      advance(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save — try again");
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
  };

  const containerWidth = desktop ? "max-w-3xl" : "max-w-md";

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
        <PoundSterling className="h-5 w-5 text-pd-accent" />
        Missing Costs Game
      </h1>

      {phase === "setup" && (
        <Card className="p-4 space-y-5">
          {/* Mode picker */}
          <div className="space-y-2">
            <Label>Mode</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={mode === "brand" ? "default" : "outline"}
                onClick={() => setMode("brand")}
                className="h-12"
              >
                Brand Focus
              </Button>
              <Button
                variant={mode === "top_sellers" ? "default" : "outline"}
                onClick={() => setMode("top_sellers")}
                className="h-12"
              >
                Top Sellers (28d)
              </Button>
            </div>
          </div>

          {/* Brand list */}
          {mode === "brand" && (
            <div className="space-y-2">
              <Label>Brand</Label>
              {loadingBrands ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading brands…
                </div>
              ) : brands.length === 0 ? (
                <div className="text-sm text-muted-foreground">No brands with missing costs 🎉</div>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  {brands.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setSelectedBrandId(b.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${
                        selectedBrandId === b.id ? "bg-pd-accent/10" : ""
                      }`}
                    >
                      <span className="text-sm font-medium text-foreground">{b.name}</span>
                      <Badge variant="secondary">{b.missing_count}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Round size */}
          <div className="space-y-2">
            <Label>Round size</Label>
            <div className="grid grid-cols-4 gap-2">
              {ROUND_SIZES.map((n) => (
                <Button
                  key={n}
                  variant={roundSize === n ? "default" : "outline"}
                  onClick={() => setRoundSize(n)}
                  className="h-12"
                >
                  {n}
                </Button>
              ))}
            </div>
          </div>

          <Button onClick={startGame} disabled={loadingBrands} className="w-full h-14 text-base">
            {loadingBrands ? <Loader2 className="h-5 w-5 animate-spin" /> : "Start Game"}
          </Button>
        </Card>
      )}

      {phase === "playing" && current && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">SKU {idx + 1} of {queue.length}</span>
            <span className="text-muted-foreground">
              ✅ {priced} &middot; ⏭ {skipped}
            </span>
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
                  <Label htmlFor="cost-input" className="text-sm">Cost price (£)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">£</span>
                    <Input
                      id="cost-input"
                      ref={inputRef}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submit();
                      }}
                      className="h-14 text-2xl pl-8 font-semibold"
                      autoFocus={desktop}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    variant="secondary"
                    onClick={() => advance(false)}
                    disabled={submitting}
                    className="h-14"
                  >
                    <SkipForward className="h-4 w-4 mr-1" /> Skip
                  </Button>
                  <Button
                    onClick={submit}
                    disabled={submitting || !cost}
                    className="h-14 bg-green-600 hover:bg-green-700 text-white"
                  >
                    {submitting ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Check className="h-5 w-5 mr-1" /> Submit
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
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="p-6 text-center space-y-4">
            <div className="flex justify-center">
              <Trophy className="h-14 w-14 text-pd-accent" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">Round complete!</h2>
            <p className="text-foreground text-lg">
              You priced <span className="font-bold text-pd-accent">{priced}</span> of {queue.length} SKUs
            </p>
            <div className="text-sm text-muted-foreground">
              Time: {Math.floor(elapsedSec / 60)}m {elapsedSec % 60}s &middot; Skipped: {skipped}
            </div>
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
