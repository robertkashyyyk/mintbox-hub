import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Maximize2, RefreshCw, Package, Clock, Target, TrendingUp, Volume2, VolumeX } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useEffect, useRef, useState } from "react";

const REFRESH_MS = 60_000;
const TARGET_PER_HOUR = 40;

const PackingAreaDisplay = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);

  // Live counters from Mintsoft snapshot (truthful, refreshed every 5 min by cron)
  const liveQuery = useQuery({
    queryKey: ["packing-live"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const [snap, despatchedHist] = await Promise.all([
        supabase.rpc("get_mintsoft_status_latest" as any).then((r) => r),
        supabase.rpc("get_despatch_hourly_today" as any).then((r) => r),
      ]);
      const rows = (snap.data as Array<{ status: string; count: number; captured_at: string }> | null) ?? [];
      const byStatus: Record<string, number> = {};
      let capturedAt: string | null = null;
      for (const r of rows) {
        byStatus[r.status] = Number(r.count);
        if (!capturedAt || r.captured_at > capturedAt) capturedAt = r.captured_at;
      }
      return {
        awaiting: byStatus["AWAITINGPICKING"] ?? 0,
        newOrders: byStatus["NEW"] ?? 0,
        backorder: byStatus["ONBACKORDER"] ?? 0,
        capturedAt,
        hourly: (despatchedHist.data as Array<{ hr: string; despatched: number }> | null) ?? [],
      };
    },
  });

  // Tick clock every 30s for cut-off countdown
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const hourly = liveQuery.data?.hourly ?? [];
  const despatchedToday = hourly.reduce((s, r) => s + Number(r.despatched ?? 0), 0);
  const nowHourKey = format(new Date(), "HH:00");
  const thisHour = hourly.find((r) => format(new Date(r.hr), "HH:00") === nowHourKey)?.despatched ?? 0;
  const hourlyProgress = Math.min(100, (Number(thisHour) / TARGET_PER_HOUR) * 100);

  // Build 8am–5pm buckets for chart
  const today = new Date();
  const chartData = Array.from({ length: 10 }, (_, i) => {
    const h = 8 + i;
    const label = `${h.toString().padStart(2, "0")}:00`;
    const row = hourly.find((r) => new Date(r.hr).getHours() === h);
    const isFuture = h > today.getHours();
    return {
      hour: label,
      despatched: isFuture ? 0 : Number(row?.despatched ?? 0),
      future: isFuture,
    };
  });

  // Cut-off alarm logic
  // Trigger if (before cut-off and after 9am) AND any of:
  //   - AwaitingPicking < 100
  //   - New > 200
  //   - New >= AwaitingPicking * 2
  const minsToCutoff = (16 * 60 + 30) - (today.getHours() * 60 + today.getMinutes());
  const awaiting = liveQuery.data?.awaiting ?? 0;
  const newOrders = liveQuery.data?.newOrders ?? 0;
  const inWindow = minsToCutoff > 0 && minsToCutoff <= (16 * 60 + 30) - (9 * 60); // 9:00 → 16:30
  const trigLowAwaiting = awaiting < 100;
  const trigNewHigh = newOrders > 200;
  const trigNewVsAwaiting = awaiting > 0 ? newOrders >= awaiting * 2 : newOrders > 0;
  const alarmActive = inWindow && (trigLowAwaiting || trigNewHigh || trigNewVsAwaiting);
  const alarmTier: "amber" | "red" | "critical" | null = !alarmActive
    ? null
    : minsToCutoff <= 60
      ? "critical"
      : minsToCutoff <= 150
        ? "red"
        : "amber";

  const cutoffH = Math.max(0, Math.floor(minsToCutoff / 60));
  const cutoffM = Math.max(0, minsToCutoff % 60);
  const cutoffPast = minsToCutoff <= 0;

  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastChimeRef = useRef<number>(0);

  const playKlaxon = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    const beeps = alarmTier === "critical" ? 4 : alarmTier === "red" ? 2 : 1;
    const freq = alarmTier === "critical" ? 880 : alarmTier === "red" ? 660 : 520;
    for (let i = 0; i < beeps; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now + i * 0.45);
      g.gain.linearRampToValueAtTime(0.18, now + i * 0.45 + 0.02);
      g.gain.linearRampToValueAtTime(0, now + i * 0.45 + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.45);
      o.stop(now + i * 0.45 + 0.4);
    }
  };

  useEffect(() => {
    if (!alarmActive || !soundEnabled) return;
    const intervalMs = alarmTier === "critical" ? 30_000 : alarmTier === "red" ? 60_000 : 120_000;
    const tick = () => {
      const now = Date.now();
      if (now - lastChimeRef.current >= intervalMs - 500) {
        lastChimeRef.current = now;
        playKlaxon();
      }
    };
    tick();
    const t = setInterval(tick, 5_000);
    return () => clearInterval(t);
  }, [alarmActive, alarmTier, soundEnabled]);

  const enableSound = () => {
    if (!audioCtxRef.current) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    audioCtxRef.current?.resume?.();
    setSoundEnabled(true);
    const ctx = audioCtxRef.current!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.3);
  };

  const handleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  return (
    <div ref={containerRef} className="space-y-6 bg-background p-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Packing Area</h1>
          <p className="text-foreground/60">Live packing & despatch · Cut-off 16:30</p>
        </div>

        {/* Big cut-off countdown */}
        <div className="flex flex-col items-center px-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {cutoffPast ? "Past cut-off" : "Time to 16:30 cut-off"}
          </div>
          <div
            className={
              "font-bold tabular-nums leading-none mt-1 " +
              (cutoffPast
                ? "text-5xl text-muted-foreground"
                : minsToCutoff <= 60
                  ? "text-6xl text-destructive"
                  : minsToCutoff <= 150
                    ? "text-6xl text-warning"
                    : "text-6xl text-foreground")
            }
          >
            {cutoffPast ? "—" : `${cutoffH}h ${String(cutoffM).padStart(2, "0")}m`}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Updated: {liveQuery.dataUpdatedAt ? format(new Date(liveQuery.dataUpdatedAt), "HH:mm:ss") : "--"}
          </Badge>
          <Button
            variant={soundEnabled ? "default" : "outline"}
            size="sm"
            onClick={() => (soundEnabled ? setSoundEnabled(false) : enableSound())}
            title={soundEnabled ? "Mute alarm" : "Enable alarm sound"}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4 mr-2" /> : <VolumeX className="h-4 w-4 mr-2" />}
            {soundEnabled ? "Sound on" : "Enable sound"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => liveQuery.refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleFullscreen}>
            <Maximize2 className="h-4 w-4 mr-2" />
            Fullscreen
          </Button>
        </div>
      </div>

      {alarmActive && (
        <Card
          className={
            alarmTier === "critical"
              ? "border-destructive bg-destructive/15 animate-pulse"
              : alarmTier === "red"
                ? "border-destructive bg-destructive/10 animate-pulse"
                : "border-warning bg-warning/10 animate-pulse"
          }
        >
          <CardContent className="py-4 flex items-center justify-between">
            <div>
              <div
                className={
                  alarmTier === "amber"
                    ? "text-2xl font-bold text-warning"
                    : "text-3xl font-bold text-destructive"
                }
              >
                ⚠ NEW PICK LISTS REQUIRED
              </div>
              <p className="text-sm text-foreground/70 mt-1">
                {[
                  trigLowAwaiting && `Awaiting Picking ${awaiting} (<100)`,
                  trigNewHigh && `New ${newOrders} (>200)`,
                  trigNewVsAwaiting && !trigLowAwaiting && `New ${newOrders} ≥ 2× Awaiting ${awaiting}`,
                ].filter(Boolean).join(" · ")} · {cutoffH}h {String(cutoffM).padStart(2, "0")}m to 16:30 cut-off
                {!soundEnabled && " · click Enable sound for audible alarm"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />
              Awaiting Picking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-warning">{awaiting}</div>
            <p className="text-sm text-muted-foreground mt-2">{newOrders} new behind</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Despatched Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-success">{despatchedToday}</div>
            <p className="text-sm text-muted-foreground mt-2">Since 00:00</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4" />
              This Hour
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold">{Number(thisHour)}</div>
            <div className="mt-2">
              <div className="h-2 w-full bg-muted rounded overflow-hidden">
                <div className="h-full bg-pd-accent" style={{ width: `${hourlyProgress}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Target: {TARGET_PER_HOUR}/hr</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Picked (queued)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold">{liveQuery.data?.picked ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-2">Ready to pack</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Despatch by Hour (today)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    color: "hsl(var(--foreground))",
                  }}
                />
                <ReferenceLine y={TARGET_PER_HOUR} stroke="hsl(var(--warning))" strokeDasharray="3 3" label={{ value: `Target ${TARGET_PER_HOUR}/hr`, fill: "hsl(var(--warning))", fontSize: 11 }} />
                <Bar dataKey="despatched" fill="hsl(var(--pd-accent))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PackingAreaDisplay;
