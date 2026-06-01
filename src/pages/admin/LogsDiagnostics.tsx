import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageLoader } from "@/components/ui/PageLoader";
import ModuleHeader from "@/components/ModuleHeader";
import DiagnosticBanner from "@/components/DiagnosticBanner";
import {
  ScrollText,
  User,
  Cpu,
  CheckCircle2,
  XCircle,
  Info,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  Filter,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────

interface ActivityLogEntry {
  id: string;
  created_at: string;
  actor_type: "user" | "system";
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  detail: Record<string, unknown> | null;
  outcome: "success" | "failure" | "info";
  error_message: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    "lsa_calibration.toggle_auto":       "LSA — toggled Auto",
    "lsa_calibration.update_threshold":  "LSA — updated threshold",
    "lsa_calibration.update_multiplier": "LSA — updated multiplier",
    "lsa_calibration.bulk_apply":        "LSA — bulk applied",
    "purchase_order.create":             "Purchase Order created",
    "purchase_order.update":             "Purchase Order updated",
    "purchase_order.submit":             "Purchase Order submitted",
    "purchase_order.delete":             "Purchase Order deleted",
    "purchase_order.line_add":           "PO line added",
    "purchase_order.line_remove":        "PO line removed",
    "reprice.trigger":                   "3D Reprice triggered",
    "reprice.complete":                  "3D Reprice completed",
    "brand.create":                      "Brand created",
    "brand.update":                      "Brand updated",
    "brand.delete":                      "Brand deleted",
    "system.mintsoft_sync":              "Mintsoft sync",
    "system.stock_health_refresh":       "Stock health refreshed",
  };
  return map[action] ?? action;
}

function outcomeIcon(outcome: string) {
  if (outcome === "success") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  if (outcome === "failure") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <Info className="h-3.5 w-3.5 text-blue-400" />;
}

function outcomeBadge(outcome: string) {
  if (outcome === "success") return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">success</Badge>;
  if (outcome === "failure") return <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-xs">failure</Badge>;
  return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-xs">info</Badge>;
}

// ── Row component ──────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: ActivityLogEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(
    entry.detail || entry.error_message || entry.entity_label || entry.entity_id
  );

  return (
    <div className="border-b border-border/40 last:border-0">
      <div
        className={`flex items-start gap-3 px-4 py-3 ${hasDetail ? "cursor-pointer hover:bg-muted/20 transition-colors" : ""}`}
        onClick={() => hasDetail && setOpen(o => !o)}
      >
        {/* Expand chevron */}
        <div className="flex-shrink-0 mt-0.5 w-4 text-muted-foreground/40">
          {hasDetail ? (
            open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : null}
        </div>

        {/* Outcome icon */}
        <div className="flex-shrink-0 mt-0.5">
          {outcomeIcon(entry.outcome)}
        </div>

        {/* Actor */}
        <div className="flex-shrink-0 w-40">
          <div className="flex items-center gap-1.5">
            {entry.actor_type === "user" ? (
              <User className="h-3 w-3 text-muted-foreground" />
            ) : (
              <Cpu className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="text-xs text-foreground/80 truncate">
              {entry.actor_email ?? (entry.actor_type === "system" ? "system" : "unknown")}
            </span>
          </div>
        </div>

        {/* Action */}
        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground">
            {actionLabel(entry.action)}
          </span>
          {entry.entity_label && (
            <span className="text-xs text-muted-foreground ml-2">
              · {entry.entity_label}
            </span>
          )}
        </div>

        {/* Outcome badge */}
        <div className="flex-shrink-0">
          {outcomeBadge(entry.outcome)}
        </div>

        {/* Time */}
        <div className="flex-shrink-0 w-28 text-right">
          <span
            className="text-xs text-muted-foreground"
            title={format(new Date(entry.created_at), "dd MMM yyyy HH:mm:ss")}
          >
            {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>

      {/* Expanded detail */}
      {open && hasDetail && (
        <div className="px-11 pb-3">
          <div className="rounded-md bg-muted/30 border border-border/30 p-3 text-xs space-y-1.5">
            {entry.entity_type && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-24 flex-shrink-0">Entity type</span>
                <span className="text-foreground">{entry.entity_type}</span>
              </div>
            )}
            {entry.entity_id && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-24 flex-shrink-0">Entity ID</span>
                <span className="text-foreground font-mono">{entry.entity_id}</span>
              </div>
            )}
            {entry.detail && Object.entries(entry.detail).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="text-muted-foreground w-24 flex-shrink-0">{k}</span>
                <span className="text-foreground font-mono break-all">
                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </span>
              </div>
            ))}
            {entry.error_message && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-24 flex-shrink-0">Error</span>
                <span className="text-destructive break-all">{entry.error_message}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const LogsDiagnostics = () => {
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["activity_log", page, outcomeFilter, actorFilter],
    queryFn: async () => {
      let q = supabase
        .from("activity_log")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (outcomeFilter !== "all") q = q.eq("outcome", outcomeFilter);
      if (actorFilter !== "all") q = q.eq("actor_type", actorFilter);

      const { data, error, count } = await q;
      if (error) throw error;
      return { entries: data as ActivityLogEntry[], total: count ?? 0 };
    },
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Client-side text search over action + actor_email + entity_label
  const filtered = search.trim()
    ? entries.filter(e => {
        const q = search.toLowerCase();
        return (
          e.action.toLowerCase().includes(q) ||
          (e.actor_email ?? "").toLowerCase().includes(q) ||
          (e.entity_label ?? "").toLowerCase().includes(q)
        );
      })
    : entries;

  const tableNotFound = error && String(error).includes("does not exist");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <ModuleHeader
          title="Activity Log"
          description="One line per action — who did what, when, and what happened."
          icon={ScrollText}
        />
        <div className="flex-shrink-0 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <DiagnosticBanner />

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search actions, users, entities…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={outcomeFilter} onValueChange={v => { setOutcomeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36">
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failure">Failure</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={actorFilter} onValueChange={v => { setActorFilter(v); setPage(0); }}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actors</SelectItem>
            <SelectItem value="user">Users</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
        {total > 0 && (
          <span className="text-xs text-muted-foreground">
            {total.toLocaleString()} total entries
          </span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <PageLoader rows={10} columns={[24, 24, 160, 320, 80, 110]} label="Loading activity log" />
            </div>
          ) : tableNotFound ? (
            <div className="py-16 text-center space-y-3">
              <ScrollText className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium text-foreground">Activity log table not yet created</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Apply the <code className="bg-muted px-1 rounded">20260601130000_create_activity_log</code> migration
                in the Supabase SQL editor to enable logging.
              </p>
            </div>
          ) : error ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-sm font-medium text-destructive">Failed to load activity log</p>
              <p className="text-xs text-muted-foreground">{String(error)}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <ScrollText className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium text-foreground">No entries yet</p>
              <p className="text-xs text-muted-foreground">
                Actions taken in the app will appear here in real time.
              </p>
            </div>
          ) : (
            <>
              {/* Column header */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border/40 bg-muted/20">
                <div className="w-4" />
                <div className="w-3.5" />
                <div className="w-40 text-xs text-muted-foreground font-medium">Actor</div>
                <div className="flex-1 text-xs text-muted-foreground font-medium">Action</div>
                <div className="w-16 text-xs text-muted-foreground font-medium">Outcome</div>
                <div className="w-28 text-right text-xs text-muted-foreground font-medium">When</div>
              </div>

              {filtered.map(entry => (
                <LogRow key={entry.id} entry={entry} />
              ))}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage(p => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage(p => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default LogsDiagnostics;
