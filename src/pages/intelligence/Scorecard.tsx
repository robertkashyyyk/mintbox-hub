import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ModuleHeader from "@/components/ModuleHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutDashboard, ArrowUp, ArrowDown, Minus, Sparkles, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Reads the single source of truth (get_scorecard). Orin narrates these same
// numbers — page and Orin can never disagree because both read this output.
interface ScorecardRow {
  area: string;
  metric_key: string;
  label: string;
  unit: "gbp" | "pct" | "count" | string;
  good_direction: "up" | "down" | "neutral" | string;
  period_label: string | null;
  current_value: number | null;
  prior_value: number | null;
  delta: number | null;
  delta_pct: number | null;
  direction: "up" | "down" | "flat" | string;
  periods_available: number;
  rag: "green" | "amber" | "red" | "none" | string;
  series: Array<{ period: string; value: number }> | null;
}

interface AiReport {
  id: string;
  cadence: "daily" | "weekly" | "monthly";
  period_key: string;
  model: string | null;
  generated_at: string;
  narrative: string | null;
  status: string;
}

const AREA_ORDER = ["profit", "profit_mix", "reprice", "dispatch", "eighty_twenty", "stock_valuation", "missing_cost"] as const;
const AREA_LABELS: Record<string, string> = {
  profit: "Profit & P&L",
  profit_mix: "Profit Tiers",
  reprice: "Repricing Payoff",
  dispatch: "Dispatch",
  eighty_twenty: "80/20 Concentration",
  stock_valuation: "Stock Valuation",
  missing_cost: "Data Quality",
};
const RAG_TILE: Record<string, string> = {
  green: "border-emerald-500/40 bg-emerald-500/5",
  amber: "border-amber-500/50 bg-amber-500/5",
  red:   "border-red-500/50 bg-red-500/5",
  none:  "border-border",
};
const RAG_BADGE: Record<string, string> = {
  green: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
  amber: "bg-amber-500/15 text-amber-600 border-amber-500/40",
  red:   "bg-red-500/15 text-red-500 border-red-500/40",
};
const MIN_PERIODS_FOR_TREND = 4; // spec: trend arrow only where >=4 periods exist

function fmt(unit: string, v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (unit === "gbp") return "£" + Math.round(v).toLocaleString("en-GB");
  if (unit === "pct") return `${Number(v).toFixed(1)}%`;
  return Math.round(v).toLocaleString("en-GB");
}

function Sparkline({ series }: { series: Array<{ period: string; value: number }> }) {
  if (!series || series.length < 2) return null;
  const vals = series.map((p) => Number(p.value));
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const w = 96, h = 26;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / span) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5"
        className="text-muted-foreground/60" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const Scorecard = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["scorecard"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_scorecard", { p_lookback_weeks: 8 });
      if (error) throw error;
      return (data || []) as ScorecardRow[];
    },
    staleTime: 60_000,
  });

  const { data: reports = [] } = useQuery({
    queryKey: ["ai-reports"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ai_reports")
        .select("id,cadence,period_key,model,generated_at,narrative,status")
        .order("generated_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data || []) as AiReport[];
    },
    staleTime: 60_000,
  });

  const latestByCadence = useMemo(() => {
    const m: Record<string, AiReport> = {};
    for (const r of reports) if (!m[r.cadence]) m[r.cadence] = r;
    return m;
  }, [reports]);

  const byArea = useMemo(() => {
    const g: Record<string, ScorecardRow[]> = {};
    for (const r of rows) (g[r.area] ||= []).push(r);
    return g;
  }, [rows]);

  const generate = async (cadence: "daily" | "weekly" | "monthly") => {
    setGenerating(cadence);
    try {
      const { data, error } = await supabase.functions.invoke("orin-report", { body: { cadence } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      await qc.invalidateQueries({ queryKey: ["ai-reports"] });
      toast({ title: `Orin ${cadence} report generated` });
    } catch (e: any) {
      toast({ title: "Generation failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Scorecard"
        description="One source of truth per metric, with Orin's narrative over the same numbers."
        icon={LayoutDashboard}
      />

      {/* Metric tiles, grouped by area */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : (
        AREA_ORDER.filter((a) => byArea[a]?.length).map((area) => (
          <div key={area} className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{AREA_LABELS[area]}</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {byArea[area].map((m) => {
                const showTrend = m.periods_available >= MIN_PERIODS_FOR_TREND && m.prior_value !== null;
                const ArrowIcon = m.direction === "up" ? ArrowUp : m.direction === "down" ? ArrowDown : Minus;
                return (
                  <Card key={m.metric_key} className={`border ${RAG_TILE[m.rag] ?? RAG_TILE.none}`}>
                    <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-foreground/80">{m.label}</CardTitle>
                      {m.rag !== "none" && (
                        <Badge variant="outline" className={`text-[10px] uppercase ${RAG_BADGE[m.rag] ?? ""}`}>{m.rag}</Badge>
                      )}
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-end justify-between gap-2">
                        <div>
                          <div className="text-2xl font-bold tabular-nums">{fmt(m.unit, m.current_value)}</div>
                          {showTrend ? (
                            <div className={`flex items-center gap-1 text-xs mt-1 ${
                              m.direction === "flat" ? "text-muted-foreground"
                              : m.rag === "red" ? "text-red-500"
                              : m.rag === "amber" ? "text-amber-600"
                              : "text-muted-foreground"}`}>
                              <ArrowIcon className="h-3 w-3" />
                              {m.delta_pct !== null ? `${m.delta_pct > 0 ? "+" : ""}${m.delta_pct}% vs prior` : "—"}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground mt-1">
                              {m.periods_available < MIN_PERIODS_FOR_TREND
                                ? `${m.periods_available} period${m.periods_available === 1 ? "" : "s"} — no trend yet`
                                : "—"}
                            </div>
                          )}
                        </div>
                        {m.series && m.series.length >= 2 && <Sparkline series={m.series} />}
                      </div>
                      {m.period_label && <div className="text-[11px] text-muted-foreground/70 mt-2">as of {m.period_label}</div>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Orin narrative */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-pd-accent" /> Orin
            <span className="text-xs font-normal text-muted-foreground">— reads the scorecard above and tells the story</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="weekly">
            <TabsList>
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="weekly">Weekly</TabsTrigger>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
            </TabsList>
            {(["daily", "weekly", "monthly"] as const).map((cad) => {
              const rep = latestByCadence[cad];
              return (
                <TabsContent key={cad} value={cad} className="mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="text-xs text-muted-foreground">
                      {rep
                        ? `Latest: ${rep.period_key} · ${new Date(rep.generated_at).toLocaleString("en-GB")} · ${rep.model ?? ""}`
                        : "No report generated yet."}
                    </div>
                    <Button size="sm" variant="outline" onClick={() => generate(cad)} disabled={generating !== null}>
                      {generating === cad ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                      Generate now
                    </Button>
                  </div>
                  {rep?.narrative ? (
                    <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap font-[450]">
                      {rep.narrative}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                      Click “Generate now” to produce the {cad} report.
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default Scorecard;
