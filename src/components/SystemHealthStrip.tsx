import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, AlertTriangle, XCircle, Clock, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

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

type JobRun = {
  runid: number;
  status: string | null;
  return_message: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_ms: number | null;
  command: string | null;
};

const JOB_META: Record<string, { label: string; expectedMaxAgeSec: number; functionName?: string }> = {
  "sync-mintsoft-orders-live-tail": { label: "Order Sync", expectedMaxAgeSec: 20 * 60, functionName: "sync-mintsoft-orders" },
  "reconcile-order-ghosts-every-15min": { label: "Ghost Closure", expectedMaxAgeSec: 20 * 60, functionName: "reconcile-order-ghosts" },
  "evaluate-order-issues-every-15min": { label: "Order Telemetry", expectedMaxAgeSec: 20 * 60, functionName: "evaluate-order-issues" },
  "sync-mintsoft-orders-daily": { label: "Daily Catch-up", expectedMaxAgeSec: 25 * 60 * 60, functionName: "sync-mintsoft-orders" },
  "poll-inventory-every-15min": { label: "Inventory Poll", expectedMaxAgeSec: 20 * 60, functionName: "poll-inventory" },
  "poll-lowstock-every-15min": { label: "Low Stock Poll", expectedMaxAgeSec: 20 * 60, functionName: "poll-lowstock" },
  "mintsoft-enrich-batch-every-30min": { label: "Product Enrichment", expectedMaxAgeSec: 40 * 60, functionName: "mintsoft-enrich-batch" },
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

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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

const RUN_STATUS_VARIANT: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  succeeded: "default",
  failed: "destructive",
  starting: "secondary",
  running: "secondary",
};

const JobRunsDialog = ({
  jobname,
  open,
  onOpenChange,
}: {
  jobname: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) => {
  const meta = jobname ? JOB_META[jobname] : null;

  const { data, isLoading, error } = useQuery({
    queryKey: ["system-health-job-runs", jobname],
    queryFn: async () => {
      if (!jobname) return [];
      const { data, error } = await supabase.rpc("get_system_health_job_runs", {
        _jobname: jobname,
        _limit: 30,
      });
      if (error) throw error;
      return data as JobRun[];
    },
    enabled: !!jobname && open,
    refetchInterval: open ? 15_000 : false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{meta?.label ?? jobname} — recent runs</DialogTitle>
          <DialogDescription className="font-mono text-xs">{jobname}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="py-6 text-sm text-destructive">Failed to load runs: {(error as Error).message}</p>
        ) : !data || data.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No run history yet.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Started</th>
                  <th className="px-3 py-2 text-left font-medium">Duration</th>
                  <th className="px-3 py-2 text-left font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {data.map((run) => {
                  const variant = RUN_STATUS_VARIANT[run.status ?? ""] ?? "outline";
                  return (
                    <tr key={run.runid} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2">
                        <Badge variant={variant} className="capitalize">
                          {run.status ?? "—"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {formatTime(run.start_time)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {formatDuration(run.duration_ms)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        <span className="line-clamp-2 break-all" title={run.return_message ?? ""}>
                          {run.return_message ?? "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">Auto-refreshes every 15s while open.</p>
      </DialogContent>
    </Dialog>
  );
};

export const SystemHealthStrip = () => {
  const [openJob, setOpenJob] = useState<string | null>(null);

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
            <button
              key={row.jobname}
              type="button"
              onClick={() => setOpenJob(row.jobname)}
              className="group flex flex-col gap-1 rounded-md border border-border/60 bg-background/40 px-2.5 py-2 text-left transition-colors hover:bg-card/80 hover:border-pd-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-pd-accent"
              title={`${row.jobname} • schedule: ${row.schedule} • last status: ${row.last_status ?? "n/a"} — click to view runs`}
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
                <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <span className="text-[11px] text-muted-foreground">
                {formatAge(row.seconds_since_last_run)}
              </span>
            </button>
          );
        })}
      </div>

      <JobRunsDialog
        jobname={openJob}
        open={!!openJob}
        onOpenChange={(v) => !v && setOpenJob(null)}
      />
    </section>
  );
};

export default SystemHealthStrip;
