import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Loader2,
  Inbox as InboxEmpty,
  AlertCircle,
  Repeat,
  Clock,
  Inbox,
  Activity,
} from "lucide-react";

import OrderFilters from "@/components/orders/OrderFilters";
import OrderTable from "@/components/orders/OrderTable";
import OrderDetail from "@/components/orders/OrderDetail";
import { useOrderTelemetry, type OpenOrderLine, type TelemetryView } from "@/hooks/useOrderTelemetry";

function timeAgo(iso: string | null | undefined): { label: string; stale: boolean } {
  if (!iso) return { label: "never", stale: true };
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  const stale = mins >= 30;
  if (mins < 1) return { label: "just now", stale: false };
  if (mins < 60) return { label: `${mins} min ago`, stale };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { label: `${hrs}h ago`, stale };
  const days = Math.floor(hrs / 24);
  return { label: `${days}d ago`, stale: true };
}

const SalesOrders = () => {
  const {
    filters,
    setFilters,
    setView,
    page, setPage, pageSize, setPageSize,
    paginated, filtered, totalPages,
    stats, filterOptions,
    isLoading, error: telemetryError, refetch,
    sortKey, sortDir, toggleSort,
    lastSyncAt,
  } = useOrderTelemetry();

  const [selectedLine, setSelectedLine] = useState<OpenOrderLine | null>(null);

  const sync = timeAgo(lastSyncAt);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Order Telemetry</h1>
          <p className="text-foreground/60 mt-1 text-sm">
            Open orders only · Surfacing Unordered, Bouncers and Chronic Backorders
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Last synced:</span>
          <span className={sync.stale ? "text-warning font-semibold" : "text-foreground font-medium"}>
            {sync.label}
          </span>
          {sync.stale && (
            <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
              Sync may be stalled
            </Badge>
          )}
        </div>
      </div>


      {/* 4 focused metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          icon={Inbox}
          label="Total Open Orders"
          value={stats.totalOpenOrders}
          tone="default"
          active={filters.view === "all_open"}
          onClick={() => setView("all_open")}
        />
        <MetricCard
          icon={AlertCircle}
          label="Unordered Items"
          value={stats.unorderedOrders}
          tone="destructive"
          active={filters.view === "unordered"}
          onClick={() => setView("unordered")}
        />
        <MetricCard
          icon={Repeat}
          label="Bouncers"
          value={stats.bouncerOrders}
          tone="warning"
          active={filters.view === "bouncers"}
          onClick={() => setView("bouncers")}
        />
        <MetricCard
          icon={Clock}
          label="Chronic Backorders"
          value={stats.chronicLines}
          tone="purple"
          active={filters.view === "backorders"}
          onClick={() => setView("backorders")}
        />
      </div>

      {/* Segmented view selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <ToggleGroup
          type="single"
          value={filters.view}
          onValueChange={(v) => v && setView(v as TelemetryView)}
          className="justify-start"
        >
          <ToggleGroupItem value="all_open" className="px-4 data-[state=on]:bg-primary/15 data-[state=on]:text-primary">
            All Open
          </ToggleGroupItem>
          <ToggleGroupItem value="unordered" className="px-4 data-[state=on]:bg-destructive/15 data-[state=on]:text-destructive">
            Unordered
          </ToggleGroupItem>
          <ToggleGroupItem value="bouncers" className="px-4 data-[state=on]:bg-warning/15 data-[state=on]:text-warning">
            Bouncers
          </ToggleGroupItem>
          <ToggleGroupItem value="backorders" className="px-4 data-[state=on]:bg-purple-500/15 data-[state=on]:text-purple-400">
            Backorders
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {filters.view === "all_open" && `Showing every open line (NEW, AWAITINGPICKING, ONBACKORDER, PICKED).`}
          {filters.view === "unordered" && `Lines with no stock and no active PO — need to be ordered.`}
          {filters.view === "bouncers" && `Orders that have bounced from Awaiting Picking back to New ≥ 2 times.`}
          {filters.view === "backorders" && `All ONBACKORDER lines. Items waiting ≥ 5 days are flagged Chronic.`}
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <OrderFilters
            filters={filters}
            setFilters={setFilters}
            filterOptions={filterOptions}
          />
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading order telemetry…</p>
            </div>
          ) : telemetryError ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <p className="text-sm font-medium text-destructive">Failed to load order telemetry</p>
              <p className="text-xs text-muted-foreground max-w-md break-words">
                {telemetryError.message || String(telemetryError)}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <InboxEmpty className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">No order lines match the current view</p>
              {filters.view !== "all_open" && (
                <Button variant="outline" size="sm" onClick={() => setView("all_open")}>
                  Show all open orders
                </Button>
              )}
            </div>
          ) : (
            <OrderTable
              lines={paginated}
              page={page}
              setPage={setPage}
              pageSize={pageSize}
              setPageSize={setPageSize}
              totalPages={totalPages}
              totalFiltered={filtered.length}
              onRowClick={setSelectedLine}
              sortKey={sortKey}
              sortDir={sortDir}
              toggleSort={toggleSort}
            />
          )}
        </CardContent>
      </Card>

      <OrderDetail line={selectedLine} onClose={() => setSelectedLine(null)} />
    </div>
  );
};

interface MetricCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: "default" | "destructive" | "warning" | "purple";
  active: boolean;
  onClick: () => void;
}

function MetricCard({ icon: Icon, label, value, tone, active, onClick }: MetricCardProps) {
  const ringMap: Record<string, string> = {
    default: "ring-primary/50",
    destructive: "ring-destructive/50",
    warning: "ring-warning/50",
    purple: "ring-purple-500/50",
  };
  const valueMap: Record<string, string> = {
    default: "",
    destructive: value > 0 ? "text-destructive" : "",
    warning: value > 0 ? "text-warning" : "",
    purple: value > 0 ? "text-purple-400" : "",
  };
  const iconMap: Record<string, string> = {
    default: "text-muted-foreground",
    destructive: "text-destructive",
    warning: "text-warning",
    purple: "text-purple-400",
  };
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={`cursor-pointer transition-colors ${active ? `ring-2 ${ringMap[tone]} bg-card/80` : "hover:bg-card/80 hover:border-pd-accent/60"}`}
    >
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${iconMap[tone]}`} />
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold ${valueMap[tone]}`}>{value.toLocaleString()}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default SalesOrders;
