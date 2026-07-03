import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCapability } from "@/hooks/useCapability";
import ModuleHeader from "@/components/ModuleHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Crosshair, Loader2, Pencil, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// War Room — leadership-only targets board. Access is enforced two ways: this page
// self-guards on the 'strategy.war_room' capability (works even while the global RBAC
// nav flag is off), and the save path (set_target_goals) re-checks the same capability
// server-side, so targets can't be changed even if the UI guard were bypassed.

type Goal = { annual: number; margin: number };
type Goals = { primary: Goal; stretch: Goal; ultimate: Goal };

interface PaceRow {
  grain: string;
  period_label: string;
  metric: "revenue" | "gross" | "orders";
  actual: number;
  exp_primary: number | null;
  exp_stretch: number | null;
  exp_ultimate: number | null;
  tier: string | null;
  tier_label: string | null;
  nearest_line: string | null;
  variance_vs_primary_pct: number | null;
  partial_cost: boolean;
}

const GRAINS: Array<{ key: string; label: string }> = [
  { key: "mtd", label: "Month to date" },
  { key: "quarter", label: "Quarter to date" },
  { key: "ytd", label: "Year to date" },
];
const GOAL_KEYS: Array<keyof Goals> = ["primary", "stretch", "ultimate"];
const GOAL_META: Record<keyof Goals, { label: string; accent: string }> = {
  primary: { label: "Primary", accent: "text-foreground" },
  stretch: { label: "Stretch", accent: "text-emerald-600" },
  ultimate: { label: "Ultimate", accent: "text-pd-accent" },
};

const gbp = (n: number | null) => (n == null ? "—" : "£" + Math.round(n).toLocaleString("en-GB"));
const gbpBig = (n: number) => "£" + Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 });
const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
const num = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-GB"));

// Behind Primary is amber; at/above Primary is green; missing target is neutral.
const tierAccent = (tier: string | null) =>
  tier == null ? "bg-muted text-muted-foreground border-border"
    : tier === "below_primary" ? "bg-amber-500/15 text-amber-600 border-amber-500/40"
      : "bg-emerald-500/15 text-emerald-600 border-emerald-500/40";

const WarRoom = () => {
  const { isAdmin, isLoading: capLoading } = useCapability("strategy.war_room");
  const qc = useQueryClient();

  const { data: goals, isLoading: goalsLoading } = useQuery({
    queryKey: ["target-model-goals"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("app_settings").select("value").eq("key", "scorecard.target_model").maybeSingle();
      if (error) throw error;
      return (data?.value?.goals ?? null) as Goals | null;
    },
    staleTime: 30_000,
  });

  const { data: pace = [], isLoading: paceLoading } = useQuery({
    queryKey: ["war-room-pace"],
    enabled: isAdmin,
    queryFn: async () => {
      const results = await Promise.all(
        GRAINS.map((g) => (supabase as any).rpc("get_target_pace", { p_grain: g.key })),
      );
      const rows: PaceRow[] = [];
      results.forEach((r: any) => { if (!r.error && Array.isArray(r.data)) rows.push(...r.data); });
      return rows;
    },
    staleTime: 60_000,
  });

  const paceByGrain = useMemo(() => {
    const m: Record<string, Record<string, PaceRow>> = {};
    for (const r of pace) { (m[r.grain] ||= {})[r.metric] = r; }
    return m;
  }, [pace]);

  const partialCost = useMemo(() => pace.some((r) => r.metric === "gross" && r.partial_cost), [pace]);

  // ---- access guard (always on, independent of the global RBAC toggle) ----
  if (capLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/access-denied" replace state={{ area: "strategy.war_room" }} />;

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="War Room"
        description="The three lines — Primary, Stretch, Ultimate — and where we are against them. Leadership only."
        icon={Crosshair}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          Restricted area — changes are logged to the audit trail.
        </div>
        {goals && <EditTargetsDialog goals={goals} onSaved={() => {
          qc.invalidateQueries({ queryKey: ["target-model-goals"] });
          qc.invalidateQueries({ queryKey: ["war-room-pace"] });
          qc.invalidateQueries({ queryKey: ["scorecard"] });
        }} />}
      </div>

      {/* The three lines */}
      {goalsLoading ? (
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : goals ? (
        <div className="grid gap-4 md:grid-cols-3">
          {GOAL_KEYS.map((k) => (
            <Card key={k} className="border">
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm font-semibold uppercase tracking-wide ${GOAL_META[k].accent}`}>{GOAL_META[k].label}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl font-bold tabular-nums">{gbpBig(goals[k].annual)}</div>
                <div className="text-xs text-muted-foreground mt-1">per year · {pct(goals[k].margin)} target margin</div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Target model not configured.</CardContent></Card>
      )}

      {/* Where we are vs the lines */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pace against target</h2>
        {paceLoading ? (
          <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {GRAINS.map((g) => {
              const rows = paceByGrain[g.key];
              const label = rows?.gross?.period_label ?? g.label;
              return (
                <Card key={g.key} className="border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">{g.label}</CardTitle>
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {(["gross", "revenue", "orders"] as const).map((metric) => {
                      const r = rows?.[metric];
                      if (!r) return null;
                      const title = metric === "gross" ? "Profit" : metric === "revenue" ? "Revenue" : "Orders";
                      const val = metric === "orders" ? num(r.actual) : gbp(r.actual);
                      const primary = metric === "orders" ? num(r.exp_primary) : gbp(r.exp_primary);
                      const vpp = r.variance_vs_primary_pct;
                      return (
                        <div key={metric} className="space-y-1">
                          <div className="flex items-baseline justify-between">
                            <span className="text-xs text-muted-foreground">{title}{metric === "gross" && partialCost ? " *" : ""}</span>
                            {r.tier_label && <Badge variant="outline" className={`text-[10px] ${tierAccent(r.tier)}`}>{r.tier_label}</Badge>}
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-lg font-bold tabular-nums">{val}</span>
                            <span className="text-[11px] text-muted-foreground">
                              vs {primary} Primary
                              {vpp != null && <span className={vpp >= 0 ? "text-emerald-600 ml-1" : "text-amber-600 ml-1"}>
                                ({vpp >= 0 ? "+" : ""}{(vpp * 100).toFixed(0)}%)
                              </span>}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {partialCost && (
          <p className="text-[11px] text-muted-foreground">* Profit is partial pending the missing-cost backlog.</p>
        )}
      </div>
    </div>
  );
};

// ---- edit dialog: goals + margins only (seasonality weights untouched) ----
function EditTargetsDialog({ goals, onSaved }: { goals: Goals; onSaved: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    primary: { annual: String(goals.primary.annual), margin: String(+(goals.primary.margin * 100).toFixed(2)) },
    stretch: { annual: String(goals.stretch.annual), margin: String(+(goals.stretch.margin * 100).toFixed(2)) },
    ultimate: { annual: String(goals.ultimate.annual), margin: String(+(goals.ultimate.margin * 100).toFixed(2)) },
  }));

  const set = (g: keyof Goals, f: "annual" | "margin", v: string) =>
    setForm((s) => ({ ...s, [g]: { ...s[g], [f]: v } }));

  const save = async () => {
    // Build the payload (margins back to fractions) and sanity-check before the round-trip.
    const payload: Goals = {
      primary: { annual: Number(form.primary.annual), margin: Number(form.primary.margin) / 100 },
      stretch: { annual: Number(form.stretch.annual), margin: Number(form.stretch.margin) / 100 },
      ultimate: { annual: Number(form.ultimate.annual), margin: Number(form.ultimate.margin) / 100 },
    };
    const bad = GOAL_KEYS.some((k) => !Number.isFinite(payload[k].annual) || !Number.isFinite(payload[k].margin));
    if (bad) { toast({ title: "Enter valid numbers", variant: "destructive" }); return; }
    if (!(payload.primary.annual <= payload.stretch.annual && payload.stretch.annual <= payload.ultimate.annual)) {
      toast({ title: "Primary ≤ Stretch ≤ Ultimate", description: "Annual goals must increase across the lines.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase as any).rpc("set_target_goals", { p_goals: payload });
      if (error) throw error;
      toast({ title: "Targets updated", description: "Daily targets regenerated for the year." });
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Pencil className="h-4 w-4 mr-2" />Adjust targets</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust annual targets</DialogTitle>
          <DialogDescription>
            Set the annual revenue goal and target margin for each line. Seasonality (month & day-of-week
            weights) is unchanged — saving rebuilds every day's target for the year.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {GOAL_KEYS.map((k) => (
            <div key={k} className="grid grid-cols-[90px_1fr_1fr] items-center gap-3">
              <span className={`text-sm font-semibold ${GOAL_META[k].accent}`}>{GOAL_META[k].label}</span>
              <div>
                <Label className="text-[11px] text-muted-foreground">Annual revenue (£)</Label>
                <Input inputMode="numeric" value={form[k].annual} onChange={(e) => set(k, "annual", e.target.value)} />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Margin (%)</Label>
                <Input inputMode="decimal" value={form[k].margin} onChange={(e) => set(k, "margin", e.target.value)} />
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save &amp; regenerate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default WarRoom;
