import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Settings, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import DiagnosticBanner from "@/components/DiagnosticBanner";

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

  // Fetch recent order lines with brand info
  const { data: orderLines, isLoading } = useQuery({
    queryKey: ["order-lines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_lines")
        .select(`
          *,
          brands (
            name
          )
        `)
        .order("order_date", { ascending: false })
        .limit(1000);

      if (error) throw error;
      return data;
    },
  });

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
          fromDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const productsMessage = data.products_created > 0 
        ? ` ${data.products_created} new products discovered and added.`
        : '';
      
      toast({
        title: "Sync Complete",
        description: `Synced ${data.orders_fetched} orders with ${data.lines_inserted} lines. ${data.lines_skipped} lines skipped (no brand match).${productsMessage}`,
      });
      queryClient.invalidateQueries({ queryKey: ["order-lines"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
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

      toast({
        title: "Settings Saved",
        description: "Dispatched status IDs updated successfully",
      });

      refetchSettings();
      setSettingsDialogOpen(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save settings",
        variant: "destructive",
      });
    }
  };

  // Get statistics
  const stats = {
    totalLines: orderLines?.length || 0,
    uniqueOrders: new Set(orderLines?.map(ol => ol.mintsoft_order_id)).size,
    totalQty: orderLines?.reduce((sum, ol) => sum + ol.qty, 0) || 0,
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Sales Orders</h1>
          <p className="text-white/60 mt-2">
            Sync and view order lines from Mintsoft
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleOpenSettings} 
            variant="outline"
            size="lg"
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
          <Button 
            onClick={handleViewStatuses} 
            variant="outline"
            size="lg"
          >
            <Eye className="mr-2 h-4 w-4" />
            View Statuses
          </Button>
          <Button 
            onClick={handleSync} 
            disabled={isSyncing}
            size="lg"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync Orders
          </Button>
        </div>
      </div>

      <DiagnosticBanner />

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Order Lines
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalLines}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unique Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.uniqueOrders}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Units
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalQty}</div>
          </CardContent>
        </Card>
      </div>

      {/* Order Lines Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Order Lines</CardTitle>
          <CardDescription>
            Showing the last 100 order lines synced from Mintsoft
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : orderLines && orderLines.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Line</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Channel Ref</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderLines.map((line) => (
                    <TableRow key={`${line.mintsoft_order_id}-${line.line_index}`}>
                      <TableCell className="font-medium">
                        {line.mintsoft_order_id}
                      </TableCell>
                      <TableCell>{line.line_index}</TableCell>
                      <TableCell>
                        {new Date(line.order_date).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {line.brands?.name || <span className="text-muted-foreground">Unknown</span>}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {line.sku}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {line.qty}
                      </TableCell>
                      <TableCell>
                        {line.channel || <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {line.channel_order_ref || <span className="text-muted-foreground">-</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p>No order lines found. Click "Sync Mintsoft Orders" to fetch data.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mintsoft Status Inspector Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mintsoft Order Statuses</DialogTitle>
            <DialogDescription>
              These are the order status IDs and names from your Mintsoft instance
            </DialogDescription>
          </DialogHeader>
          {isLoadingStatuses ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
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
                      <TableCell>{status.ExternalName || "-"}</TableCell>
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
            <DialogDescription>
              Configure which Mintsoft order statuses should be considered "dispatched" for order ingestion
            </DialogDescription>
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
                Enter comma-separated Mintsoft Order Status IDs that count as fully dispatched/shipped orders.
                Use "View Statuses" to find the correct IDs for your Mintsoft instance.
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
              <Button onClick={handleSaveSettings}>
                Save Settings
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SalesOrders;
