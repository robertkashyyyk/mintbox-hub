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
import { RefreshCw, Settings, Eye, AlertTriangle, ShieldAlert, CircleAlert, Inbox, Zap } from "lucide-react";
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
    refetch,
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
          <h1 className="text-3xl font-bold text-white">Order Telemetry</h1>
          <p className="text-white/60 mt-1">Operational monitoring · Problem detection · Issue tracking</p>
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card
          className={`cursor-pointer transition-colors ${filters.savedView === "needs_action" ? "ring-2 ring-orange-500/50" : "hover:bg-muted/50"}`}
          onClick={() => applySavedView("needs_action")}
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
        <Card>
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
        <Card>
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
        <Card>
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
        <Card>
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
        <Card>
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
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
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
