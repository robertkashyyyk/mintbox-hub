import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Cfg = {
  enabled: boolean;
  run_hour_london: number;
  lookback_days: number;
  current_bands: string[];
  current_band?: string; // legacy single-band (kept in sync for backward compatibility)
  move_to_tier: string;
};
const DEFAULT: Cfg = { enabled: true, run_hour_london: 8, lookback_days: 30, current_bands: ["loss", "breakeven", "poor"], move_to_tier: "average" };

const BANDS = [
  { v: "loss", l: "Loss" }, { v: "breakeven", l: "Breakeven" }, { v: "poor", l: "Poor" },
  { v: "average", l: "Average" }, { v: "good", l: "Good" }, { v: "great", l: "Great" }, { v: "amazing", l: "Amazing" }, { v: "stellar", l: "Stellar" },
];
const TIERS = [
  { v: "breakeven", l: "Breakeven" }, { v: "poor", l: "Poor" }, { v: "average", l: "Average" },
  { v: "good", l: "Good" }, { v: "great", l: "Great" }, { v: "amazing", l: "Amazing" }, { v: "stellar", l: "Stellar" },
];

export const AutoRepriceReportCard = () => {
  const { toast } = useToast();
  const [c, setC] = useState<Cfg>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "reprice.auto_report").maybeSingle();
      if (data?.value) {
        const v = data.value as any;
        setC({ ...DEFAULT, ...v, current_bands: Array.isArray(v.current_bands) ? v.current_bands : v.current_band ? [v.current_band] : DEFAULT.current_bands });
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const payload = { ...c, current_band: c.current_bands[0] ?? "loss" }; // keep legacy field in sync
    const { error } = await supabase.from("app_settings").upsert({ key: "reprice.auto_report", value: payload as any });
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else toast({ title: "Saved", description: "Auto-Report settings updated" });
  };

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("threeds-reprice-auto-snapshot", { body: { force: true } });
    setRunning(false);
    if (error) toast({ title: "Run failed", description: error.message, variant: "destructive" });
    else toast({ title: "Snapshot built", description: `${(data as any)?.total ?? 0} candidates across accounts. Open 3D Reprice → Auto-Report.` });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" /> 3D Reprice — Auto-Report</CardTitle>
        <CardDescription>
          A daily snapshot across all accounts of the chosen band → target tier, ready to review and push in 3D Reprice → Auto-Report.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Label>Enabled (daily snapshot)</Label>
              <Switch checked={c.enabled} onCheckedChange={(v) => setC({ ...c, enabled: v })} />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Run hour (London)</Label>
                <Input type="number" min={0} max={23} value={c.run_hour_london}
                  onChange={(e) => setC({ ...c, run_hour_london: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })} />
              </div>
              <div className="space-y-2">
                <Label>Look-back (days)</Label>
                <Select value={String(c.lookback_days)} onValueChange={(v) => setC({ ...c, lookback_days: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[30, 60, 90, 180].map((d) => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Move prices to</Label>
                <Select value={c.move_to_tier} onValueChange={(v) => setC({ ...c, move_to_tier: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TIERS.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Bands to sweep → raise to target</Label>
              <div className="flex flex-wrap gap-1.5">
                {BANDS.map((b) => {
                  const on = c.current_bands.includes(b.v);
                  return (
                    <button key={b.v} type="button"
                      onClick={() => setC({ ...c, current_bands: on ? c.current_bands.filter((x) => x !== b.v) : [...c.current_bands, b.v] })}
                      className={`px-2.5 py-1 rounded-md border text-xs transition ${on ? "border-pd-accent bg-pd-accent/15 text-pd-accent font-medium" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
                      {b.l}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Every line in a selected band gets a suggested raise to the target tier. Loss + Breakeven + Poor selected = sweep everything below target upward.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Runs at {String(c.run_hour_london).padStart(2, "0")}:00 Europe/London daily. The Auto-Report tab is locked to these values —
              use Semi-Manual for ad-hoc parameters.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <Button onClick={save} disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save settings"}</Button>
              <Button variant="outline" onClick={runNow} disabled={running}>{running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Building…</> : "Build snapshot now"}</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
