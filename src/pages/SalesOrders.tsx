import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Settings, Eye, AlertTriangle, ShieldAlert, CircleAlert, Inbox, Zap, Loader2, Inbox as InboxEmpty } from "lucide-react";
import DiagnosticBanner from "@/components/DiagnosticBanner";
import OrderFilters from "@/components/orders/OrderFilters";
import OrderTable from "@/components/orders/OrderTable";
import OrderDetail from "@/components/orders/OrderDetail";
import { useOrderTelemetry, type EnrichedOrderLine } from "@/hooks/useOrderTelemetry";

interface MintsoftStatus {
  ID: number;
  Name: string;
  ExternalName: string;
  Active: boolean;
}

const SalesOrders = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [dispatchedStatusIds, setDispatchedStatusIds] = useState<string>("");
  const [selectedLine, setSelectedLine] = useState<EnrichedOrderLine | null>(null);

  const {
    filters,
    setFilters,
    applySavedView,
    page,
    setPage,
    pageSize,
    setPageSize,
    paginatedLines,
    filteredLines,
    totalPages,
    stats,
    filterOptions,
    isLoading,
    error: telemetryError,
    refetch,
    sortKey,
    sortDir,
    toggleSort,
  } = useOrderTelemetry();

  const { data: mintsoftSettings, refetch: refetchSettings } = useQuery({
    queryKey: ["mintsoft-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mintsoft_settings")
        .select("dispatched_status_ids")
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: statusesData, isLoading: isLoadingStatuses, refetch: refetchStatuses } = useQuery({
    queryKey: ["mintsoft-statuses"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("mintsoft-statuses");
      if (error) throw error;
      return data as { statuses: MintsoftStatus[] };
    },
    enabled: false,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      let totalLines = 0;
      let totalProducts = 0;
      let runs = 0;
      const MAX_RUNS = 5;
      
      while (runs < MAX_RUNS) {
        runs++;
        const { data, error } = await supabase.functions.invoke("sync-mintsoft-orders", {
          body: { fromDate },
        });
        if (error) throw error;
        totalLines += data.lines_inserted || 0;
        totalProducts += data.products_created || 0;
        
        if (!data.partial) {
          return { ...data, lines_inserted: totalLines, products_created: totalProducts, runs };
        }
        // Partial result — run again to continue
        toast({ title: `Sync pass ${runs} complete`, description: `${totalLines} lines so far, continuing...` });
      }
      return { orders_fetched: 0, statuses_queried: 0, lines_inserted: totalLines, products_created: totalProducts, runs, partial: true };
    },
    onSuccess: (data) => {
      const msg = data.products_created > 0 ? ` ${data.products_created} new products discovered.` : "";
      const partial = data.partial ? " (may need another sync for remaining orders)" : "";
      toast({
        title: "Sync Complete",
        description: `${data.lines_inserted} lines synced in ${data.runs} pass(es).${msg}${partial}`,
      });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Sync Failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await syncMutation.mutateAsync();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleViewStatuses = () => {
    setStatusDialogOpen(true);
    refetchStatuses();
  };

  const handleOpenSettings = () => {
    if (mintsoftSettings?.dispatched_status_ids) {
      setDispatchedStatusIds(mintsoftSettings.dispatched_status_ids.join(", "));
    }
    setSettingsDialogOpen(true);
  };

  const handleSaveSettings = async () => {
    try {
      const idsArray = dispatchedStatusIds
        .split(",")
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id));
      const { error } = await supabase
        .from("mintsoft_settings")
        .update({ dispatched_status_ids: idsArray })
        .eq("id", true);
      if (error) throw error;
      toast({ title: "Settings Saved" });
      refetchSettings();
      setSettingsDialogOpen(false);
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to save", variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Order Telemetry</h1>
          <p className="text-foreground/60 mt-1">Operational monitoring · Problem detection · Issue tracking</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleOpenSettings} variant="outline" size="sm">
            <Settings className="mr-1.5 h-4 w-4" />
            Settings
          </Button>
          <Button onClick={handleViewStatuses} variant="outline" size="sm">
            <Eye className="mr-1.5 h-4 w-4" />
            Statuses
          </Button>
          <Button onClick={handleSync} disabled={isSyncing} size="sm">
            <RefreshCw className={`mr-1.5 h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            Sync Orders
          </Button>
        </div>
      </div>

      <DiagnosticBanner />

      {/* Summary Cards — each is a one-click filter */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card
          role="button"
          tabIndex={0}
          aria-pressed={filters.savedView === "needs_action"}
          title="Open or in-review issues with severity 'problem' or 'critical', excluding suppressed lines."
          className={`cursor-pointer transition-colors ${filters.savedView === "needs_action" ? "ring-2 ring-orange-500/50 bg-card/80" : "hover:bg-card/80 hover:border-pd-accent/60"}`}
          onClick={() => applySavedView("needs_action")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applySavedView("needs_action"); } }}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-orange-400" />
              <div>
                <p className="text-xs text-muted-foreground">Needs Action</p>
                <p className={`text-xl font-bold ${stats.needsActionCount > 0 ? "text-orange-400" : ""}`}>{stats.needsActionCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          aria-pressed={filters.savedView === "all"}
          title="Show every order line currently loaded — no filters applied."
          className={`cursor-pointer transition-colors ${filters.savedView === "all" ? "ring-2 ring-pd-accent/50 bg-card/80" : "hover:bg-card/80 hover:border-pd-accent/60"}`}
          onClick={() => applySavedView("all")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applySavedView("all"); } }}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Total Orders</p>
                <p className="text-xl font-bold">{stats.totalOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          aria-pressed={filters.savedView === "all"}
          title="Total order lines across all loaded orders."
          className={`cursor-pointer transition-colors ${filters.savedView === "all" ? "ring-2 ring-pd-accent/50 bg-card/80" : "hover:bg-card/80 hover:border-pd-accent/60"}`}
          onClick={() => applySavedView("all")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applySavedView("all"); } }}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Order Lines</p>
                <p className="text-xl font-bold">{stats.totalLines}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          aria-pressed={filters.savedView === "problems"}
          title="Lines with any unresolved issue (excludes auto_resolved and resolved)."
          className={`cursor-pointer transition-colors ${filters.savedView === "problems" ? "ring-2 ring-orange-500/50 bg-card/80" : "hover:bg-card/80 hover:border-pd-accent/60"}`}
          onClick={() => applySavedView("problems")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applySavedView("problems"); } }}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-400" />
              <div>
                <p className="text-xs text-muted-foreground">Problem Lines</p>
                <p className={`text-xl font-bold ${stats.problemCount > 0 ? "text-orange-400" : ""}`}>{stats.problemCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          aria-pressed={filters.savedView === "critical"}
          title="Open issues with severity 'critical'."
          className={`cursor-pointer transition-colors ${filters.savedView === "critical" ? "ring-2 ring-red-500/50 bg-card/80" : "hover:bg-card/80 hover:border-pd-accent/60"}`}
          onClick={() => applySavedView("critical")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applySavedView("critical"); } }}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-400" />
              <div>
                <p className="text-xs text-muted-foreground">Critical</p>
                <p className={`text-xl font-bold ${stats.criticalCount > 0 ? "text-red-400" : ""}`}>{stats.criticalCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          aria-pressed={filters.savedView === "open_issues"}
          title="Issues with status 'open' or 'in_review' (any severity, not suppressed)."
          className={`cursor-pointer transition-colors ${filters.savedView === "open_issues" ? "ring-2 ring-amber-500/50 bg-card/80" : "hover:bg-card/80 hover:border-pd-accent/60"}`}
          onClick={() => applySavedView("open_issues")}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applySavedView("open_issues"); } }}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <CircleAlert className="h-4 w-4 text-amber-400" />
              <div>
                <p className="text-xs text-muted-foreground">Open Issues</p>
                <p className={`text-xl font-bold ${stats.openIssueCount > 0 ? "text-amber-400" : ""}`}>{stats.openIssueCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Definition helper for the active view */}
      <p className="text-xs text-muted-foreground -mt-1">
        {filters.savedView === "needs_action" && (
          <>Showing <span className="text-foreground font-medium">{stats.needsActionCount.toLocaleString()}</span> lines that need action — open/in-review issues with severity <em>problem</em> or <em>critical</em>, suppressed lines excluded. Click another card to change filter.</>
        )}
        {filters.savedView === "all" && (
          <>Showing all <span className="text-foreground font-medium">{stats.totalLines.toLocaleString()}</span> loaded lines across <span className="text-foreground font-medium">{stats.totalOrders.toLocaleString()}</span> orders. Click a card to filter.</>
        )}
        {filters.savedView === "problems" && (
          <>Showing <span className="text-foreground font-medium">{stats.problemCount.toLocaleString()}</span> lines with unresolved issues (auto-resolved and resolved excluded).</>
        )}
        {filters.savedView === "critical" && (
          <>Showing <span className="text-foreground font-medium">{stats.criticalCount.toLocaleString()}</span> open critical-severity lines.</>
        )}
        {filters.savedView === "open_issues" && (
          <>Showing <span className="text-foreground font-medium">{stats.openIssueCount.toLocaleString()}</span> lines with open or in-review issues (any severity).</>
        )}
      </p>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <OrderFilters
            filters={filters}
            setFilters={setFilters}
            applySavedView={applySavedView}
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
              <p className="text-sm text-muted-foreground">Loading order telemetry — this may take a moment for large datasets…</p>
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
          ) : filteredLines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <InboxEmpty className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">No order lines match the current filters</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.totalLines > 0
                    ? `${stats.totalLines.toLocaleString()} lines loaded — try clearing filters or switching saved view.`
                    : "No order lines have been synced yet. Click Sync Orders to fetch from Mintsoft."}
                </p>
              </div>
              {filters.savedView !== "all" && (
                <Button variant="outline" size="sm" onClick={() => applySavedView("all")}>
                  Show all orders
                </Button>
              )}
            </div>
          ) : (
            <OrderTable
              lines={paginatedLines}
              page={page}
              setPage={setPage}
              pageSize={pageSize}
              setPageSize={setPageSize}
              totalPages={totalPages}
              totalFiltered={filteredLines.length}
              onRowClick={setSelectedLine}
              sortKey={sortKey}
              sortDir={sortDir}
              toggleSort={toggleSort}
            />
          )}
        </CardContent>
      </Card>

      {/* Detail Panel */}
      <OrderDetail line={selectedLine} onClose={() => setSelectedLine(null)} />

      {/* Mintsoft Status Inspector Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mintsoft Order Statuses</DialogTitle>
            <DialogDescription>Order status IDs and names from your Mintsoft instance</DialogDescription>
          </DialogHeader>
          {isLoadingStatuses ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : statusesData?.statuses ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>External Name</TableHead>
                    <TableHead>Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statusesData.statuses.map(status => (
                    <TableRow key={status.ID}>
                      <TableCell className="font-medium">{status.ID}</TableCell>
                      <TableCell>{status.Name}</TableCell>
                      <TableCell>{status.ExternalName || "—"}</TableCell>
                      <TableCell>
                        <span className={status.Active ? "text-green-600" : "text-muted-foreground"}>
                          {status.Active ? "Yes" : "No"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-center py-4 text-muted-foreground">No statuses loaded</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Mintsoft Sync Settings</DialogTitle>
            <DialogDescription>Configure dispatched status IDs for order ingestion</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dispatched-ids">Dispatched Status IDs</Label>
              <Input
                id="dispatched-ids"
                value={dispatchedStatusIds}
                onChange={e => setDispatchedStatusIds(e.target.value)}
                placeholder="e.g., 40, 45, 50"
              />
              <p className="text-sm text-muted-foreground">
                Comma-separated Mintsoft Status IDs. The sync now fetches ALL active statuses automatically.
              </p>
              {mintsoftSettings?.dispatched_status_ids && (
                <p className="text-sm font-medium">Current: {mintsoftSettings.dispatched_status_ids.join(", ")}</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSettingsDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveSettings}>Save Settings</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SalesOrders;
