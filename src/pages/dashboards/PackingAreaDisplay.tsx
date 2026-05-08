import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Maximize2, RefreshCw, Package, Clock, Target, TrendingUp, Volume2, VolumeX } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useEffect, useRef, useState } from "react";

const REFRESH_MS = 60_000;
const TARGET_PER_HOUR = 80;
const TARGET_PER_HALFHOUR = 40;

// Half-hour throughput colour bands (count → semantic token)
const bandForCount = (n: number): string => {
  if (n < 8) return "hsl(var(--destructive))"; // dark red
  if (n < 16) return "hsl(0 75% 60%)"; // red
  if (n < 24) return "hsl(25 90% 55%)"; // orange
  if (n < 32) return "hsl(var(--warning))"; // yellow
  if (n < 40) return "hsl(140 55% 45%)"; // green
  if (n < 50) return "hsl(200 80% 60%)"; // light blue
  return "hsl(240 60% 60%)"; // indigo
};

// SLA targets (% of today's despatches that should be inside each window)
const SLA_TARGETS = { under_6h: 60, under_12h: 85, under_24h: 95 } as const;

const PackingAreaDisplay = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);

  // Live counters from Mintsoft snapshot (truthful, refreshed every 5 min by cron)
  const liveQuery = useQuery({
    queryKey: ["packing-live"],
    refetchInterval: REFRESH_MS,
    queryFn: async () => {
      const [snap, despatchedHist, sla] = await Promise.all([
        supabase.rpc("get_mintsoft_status_latest" as any).then((r) => r),
        supabase.rpc("get_despatch_halfhourly_today" as any).then((r) => r),
        (async () => {
          const today = new Date();
          const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          return supabase.rpc("get_despatch_performance_buckets" as any, {
            from_date: iso,
            to_date: iso,
            bucket: "day",
            channels: null,
          });
        })(),
      ]);
      const rows = (snap.data as Array<{ status: string; count: number; captured_at: string }> | null) ?? [];
      const byStatus: Record<string, number> = {};
      let capturedAt: string | null = null;
      for (const r of rows) {
        byStatus[r.status] = Number(r.count);
        if (!capturedAt || r.captured_at > capturedAt) capturedAt = r.captured_at;
      }
      const slaRows = (sla.data as Array<any> | null) ?? [];
      // pick the rolled-up "all channels" row (channel IS NULL)
      const slaRow = slaRows.find((r) => r.channel == null) ?? slaRows[0] ?? null;
      return {
        awaiting: byStatus["AWAITINGPICKING"] ?? 0,
        newOrders: byStatus["NEW"] ?? 0,
        backorder: byStatus["ONBACKORDER"] ?? 0,
        capturedAt,
        halfHourly: (despatchedHist.data as Array<{ slot: string; despatched: number }> | null) ?? [],
        sla: slaRow,
      };
    },
  });

  // Tick clock every 30s for cut-off countdown
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const halfHourly = liveQuery.data?.halfHourly ?? [];
  const despatchedToday = halfHourly.reduce((s, r) => s + Number(r.despatched ?? 0), 0);

  // Build 08:00 → 17:00 in 30-minute slots for the chart
  const today = new Date();
  const nowMins = today.getHours() * 60 + today.getMinutes();
  const chartData = Array.from({ length: 18 }, (_, i) => {
    const totalMins = 8 * 60 + i * 30;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const row = halfHourly.find((r) => {
      const d = new Date(r.slot);
      return d.getHours() === h && d.getMinutes() === m;
    });
    const isFuture = totalMins > nowMins;
    const count = isFuture ? 0 : Number(row?.despatched ?? 0);
    return {
      slot: label,
      despatched: count,
      future: isFuture,
      fill: isFuture ? "hsl(var(--muted))" : bandForCount(count),
    };
  });

  // Current-half-hour progress
  const currentSlotMins = Math.floor(nowMins / 30) * 30;
  const currentSlot = chartData.find((r) => {
    const [hh, mm] = r.slot.split(":").map(Number);
    return hh * 60 + mm === currentSlotMins;
  });
  const thisHalfHourCount = currentSlot?.despatched ?? 0;

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
              New Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-foreground">{newOrders}</div>
            <p className="text-sm text-muted-foreground mt-2">Awaiting pick list</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Awaiting Picking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-warning">{awaiting}</div>
            <p className="text-sm text-muted-foreground mt-2">On pick lists, not yet picked</p>
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
            <p className="text-sm text-muted-foreground mt-2">Since 00:00 UK</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4" />
              On Backorder
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-destructive">{liveQuery.data?.backorder ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-2">Awaiting stock</p>
          </CardContent>
        </Card>
      </div>

      {(() => {
        const sla = liveQuery.data?.sla as any;
        const total = Number(sla?.total ?? 0);
        const pct = (n: number) => (total > 0 ? Math.round((Number(n ?? 0) / total) * 1000) / 10 : 0);
        const items = [
          { key: "under_6h", label: "≤ 6 hrs", value: Number(sla?.under_6h ?? 0), target: SLA_TARGETS.under_6h },
          { key: "under_12h", label: "≤ 12 hrs", value: Number(sla?.under_12h ?? 0), target: SLA_TARGETS.under_12h },
          { key: "under_24h", label: "≤ 24 hrs", value: Number(sla?.under_24h ?? 0), target: SLA_TARGETS.under_24h },
        ];
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" /> Despatch SLA — today
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                % of {total} despatches inside each window (order received → despatched)
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                {items.map((it) => {
                  const p = pct(it.value);
                  const hit = p >= it.target;
                  return (
                    <div key={it.key} className="rounded-md border border-border p-4">
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm text-muted-foreground">{it.label}</span>
                        <span className="text-xs text-muted-foreground">target {it.target}%</span>
                      </div>
                      <div className={`text-4xl font-bold tabular-nums mt-1 ${hit ? "text-success" : p >= it.target - 10 ? "text-warning" : "text-destructive"}`}>
                        {p}%
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {it.value} of {total}
                      </div>
                      <div className="mt-2 h-2 w-full rounded bg-muted overflow-hidden">
                        <div
                          className={hit ? "h-full bg-success" : p >= it.target - 10 ? "h-full bg-warning" : "h-full bg-destructive"}
                          style={{ width: `${Math.min(100, p)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <Card>
        <CardHeader>
          <CardTitle>Despatch by 30-minute slot (today)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Target {TARGET_PER_HALFHOUR}/30-min ({TARGET_PER_HOUR}/hr) · current slot: <span className="font-semibold text-foreground">{thisHalfHourCount}</span>
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="slot" stroke="hsl(var(--muted-foreground))" interval={0} tick={{ fontSize: 11 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    color: "hsl(var(--foreground))",
                  }}
                />
                <ReferenceLine
                  y={TARGET_PER_HALFHOUR}
                  stroke="hsl(var(--warning))"
                  strokeDasharray="3 3"
                  label={{ value: `Target ${TARGET_PER_HALFHOUR}/30m`, fill: "hsl(var(--warning))", fontSize: 11 }}
                />
                <Bar dataKey="despatched" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <Cell key={`c-${idx}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {[
              { c: bandForCount(0), l: "<8" },
              { c: bandForCount(8), l: "8–15" },
              { c: bandForCount(16), l: "16–23" },
              { c: bandForCount(24), l: "24–31" },
              { c: bandForCount(32), l: "32–39" },
              { c: bandForCount(40), l: "40–49" },
              { c: bandForCount(50), l: "50+" },
            ].map((b) => (
              <span key={b.l} className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: b.c }} />
                {b.l}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PackingAreaDisplay;
