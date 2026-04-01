import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { RefreshCw, Settings, Eye, AlertTriangle, ShieldAlert, CircleAlert, Inbox } from "lucide-react";
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

  // Fetch Mintsoft settings
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

  // Fetch Mintsoft statuses
  const { data: statusesData, isLoading: isLoadingStatuses, refetch: refetchStatuses } = useQuery({
    queryKey: ["mintsoft-statuses"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("mintsoft-statuses");
      if (error) throw error;
      return data as { statuses: MintsoftStatus[] };
    },
    enabled: false,
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sync-mintsoft-orders", {
        body: {
          fromDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const productsMessage =
        data.products_created > 0 ? ` ${data.products_created} new products discovered.` : "";
      toast({
        title: "Sync Complete",
        description: `Synced ${data.orders_fetched} orders with ${data.lines_inserted} lines.${productsMessage}`,
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
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id));
      const { error } = await supabase
        .from("mintsoft_settings")
        .update({ dispatched_status_ids: idsArray })
        .eq("id", true);
      if (error) throw error;
      toast({ title: "Settings Saved" });
      refetchSettings();
      setSettingsDialogOpen(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save",
        variant: "destructive",
      });
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
                <p className="text-xl font-bold text-orange-400">{stats.problemCount}</p>
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
                <p className="text-xl font-bold text-red-400">{stats.criticalCount}</p>
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
                <p className="text-xl font-bold text-amber-400">{stats.openIssueCount}</p>
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
                  {statusesData.statuses.map((status) => (
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
                onChange={(e) => setDispatchedStatusIds(e.target.value)}
                placeholder="e.g., 40, 45, 50"
              />
              <p className="text-sm text-muted-foreground">
                Comma-separated Mintsoft Status IDs for dispatched/shipped orders.
              </p>
              {mintsoftSettings?.dispatched_status_ids && (
                <p className="text-sm font-medium">
                  Current: {mintsoftSettings.dispatched_status_ids.join(", ")}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSettingsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveSettings}>Save Settings</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SalesOrders;
