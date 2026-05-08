import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gauge, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Schedule = {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  day_of_week: number;   // 0=Sun..6=Sat
  day_of_month: number;  // 1..28
  time_uk: string;       // HH:MM
  dry_run: boolean;
};

const DEFAULT: Schedule = {
  enabled: false, frequency: "weekly", day_of_week: 1,
  day_of_month: 1, time_uk: "06:00", dry_run: true,
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const AutoLsaScheduleCard = () => {
  const { toast } = useToast();
  const [s, setS] = useState<Schedule>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_settings")
        .select("value").eq("key", "lsa.auto_update_schedule").maybeSingle();
      if (data?.value) setS({ ...DEFAULT, ...(data.value as any) });
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("app_settings")
      .upsert({ key: "lsa.auto_update_schedule", value: s as any });
    setSaving(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else toast({ title: "Schedule saved" });
  };

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("auto-update-lsa-cron", {
      body: { dry_run: s.dry_run },
    });
    setRunning(false);
    if (error) toast({ title: "Run failed", description: error.message, variant: "destructive" });
    else toast({
      title: s.dry_run ? "Dry run complete" : "Run complete",
      description: `Brands: ${(data as any)?.brands_processed ?? 0} • Updated: ${(data as any)?.total_updated ?? 0} • Failed: ${(data as any)?.total_failed ?? 0}`,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="h-5 w-5" /> Auto Update LSA — Cron Schedule
        </CardTitle>
        <CardDescription>
          When enabled, brands with “Auto Update LSA” turned on will have their target LSA pushed to Mintsoft on this schedule.
          Per-brand toggles live on the Brands page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <Label>Enabled (master switch)</Label>
              <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} />
            </div>

            <div className="flex items-center justify-between">
              <Label>Dry run (log only — no Mintsoft writes)</Label>
              <Switch checked={s.dry_run} onCheckedChange={(v) => setS({ ...s, dry_run: v })} />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={s.frequency} onValueChange={(v: any) => setS({ ...s, frequency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {s.frequency === "weekly" && (
                <div className="space-y-2">
                  <Label>Day of week</Label>
                  <Select value={String(s.day_of_week)} onValueChange={(v) => setS({ ...s, day_of_week: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOW.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {s.frequency === "monthly" && (
                <div className="space-y-2">
                  <Label>Day of month (1–28)</Label>
                  <Input type="number" min={1} max={28} value={s.day_of_month}
                    onChange={(e) => setS({ ...s, day_of_month: Math.max(1, Math.min(28, Number(e.target.value) || 1)) })} />
                </div>
              )}

              <div className="space-y-2">
                <Label>Time (UK)</Label>
                <Input type="time" value={s.time_uk}
                  onChange={(e) => setS({ ...s, time_uk: e.target.value })} />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button onClick={save} disabled={saving}>
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save schedule"}
              </Button>
              <Button variant="outline" onClick={runNow} disabled={running}>
                {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running…</> : "Run now (all auto-LSA brands)"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
