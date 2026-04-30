import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, AlertTriangle, XCircle, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type JobRow = {
  jobname: string;
  schedule: string;
  active: boolean;
  last_start: string | null;
  last_end: string | null;
  last_status: string | null;
  last_duration_ms: number | null;
  seconds_since_last_run: number | null;
};

// Friendly labels for the jobs we care about most.
// Anything not listed here is hidden from the strip (kept tight & glanceable).
const JOB_META: Record<string, { label: string; expectedMaxAgeSec: number }> = {
  "sync-mintsoft-orders-live-tail": { label: "Order Sync", expectedMaxAgeSec: 20 * 60 },
  "evaluate-order-issues-every-15min": { label: "Order Telemetry", expectedMaxAgeSec: 20 * 60 },
  "sync-mintsoft-orders-daily": { label: "Daily Catch-up", expectedMaxAgeSec: 25 * 60 * 60 },
  "poll-inventory-every-15min": { label: "Inventory Poll", expectedMaxAgeSec: 20 * 60 },
  "poll-lowstock-every-15min": { label: "Low Stock Poll", expectedMaxAgeSec: 20 * 60 },
  "mintsoft-enrich-batch-every-30min": { label: "Product Enrichment", expectedMaxAgeSec: 40 * 60 },
  "refresh-sku-velocity-daily": { label: "Velocity Refresh", expectedMaxAgeSec: 25 * 60 * 60 },
};

function formatAge(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type Health = "ok" | "warn" | "fail" | "unknown";

function getHealth(row: JobRow, expectedMaxAgeSec: number): Health {
  if (row.last_status === "failed") return "fail";
  if (row.seconds_since_last_run == null) return "unknown";
  if (row.seconds_since_last_run > expectedMaxAgeSec * 2) return "fail";
  if (row.seconds_since_last_run > expectedMaxAgeSec) return "warn";
  return "ok";
}

const HEALTH_STYLES: Record<Health, { dot: string; icon: typeof CheckCircle2; label: string }> = {
  ok: { dot: "bg-emerald-500", icon: CheckCircle2, label: "Healthy" },
  warn: { dot: "bg-amber-500", icon: AlertTriangle, label: "Delayed" },
  fail: { dot: "bg-destructive", icon: XCircle, label: "Failing" },
  unknown: { dot: "bg-muted-foreground/40", icon: Clock, label: "Unknown" },
};

export const SystemHealthStrip = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["system-health-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_system_health_jobs");
      if (error) throw error;
      return data as JobRow[];
    },
    refetchInterval: 60_000,
  });

  const rows = (data ?? [])
    .filter((r) => JOB_META[r.jobname])
    .sort((a, b) => {
      const order = Object.keys(JOB_META);
      return order.indexOf(a.jobname) - order.indexOf(b.jobname);
    });

  const overall: Health = rows.some((r) => getHealth(r, JOB_META[r.jobname].expectedMaxAgeSec) === "fail")
    ? "fail"
    : rows.some((r) => getHealth(r, JOB_META[r.jobname].expectedMaxAgeSec) === "warn")
      ? "warn"
      : rows.length
        ? "ok"
        : "unknown";

  return (
    <section className="mb-8 rounded-xl border border-border bg-card/60 px-4 py-3 md:px-5 md:py-4">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", HEALTH_STYLES[overall].dot)} aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight text-foreground">System Health</h2>
          <span className="text-xs text-muted-foreground">{HEALTH_STYLES[overall].label}</span>
        </div>
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
        {rows.map((row) => {
          const meta = JOB_META[row.jobname];
          const health = getHealth(row, meta.expectedMaxAgeSec);
          const Icon = HEALTH_STYLES[health].icon;
          return (
            <div
              key={row.jobname}
              className="flex flex-col gap-1 rounded-md border border-border/60 bg-background/40 px-2.5 py-2"
              title={`${row.jobname} • schedule: ${row.schedule} • last status: ${row.last_status ?? "n/a"}`}
            >
              <div className="flex items-center gap-1.5">
                <Icon
                  className={cn(
                    "h-3.5 w-3.5",
                    health === "ok" && "text-emerald-500",
                    health === "warn" && "text-amber-500",
                    health === "fail" && "text-destructive",
                    health === "unknown" && "text-muted-foreground",
                  )}
                />
                <span className="truncate text-xs font-medium text-foreground">{meta.label}</span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {formatAge(row.seconds_since_last_run)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default SystemHealthStrip;
