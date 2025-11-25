import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Download } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

const SalesOrders = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

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
        .limit(100);

      if (error) throw error;
      return data;
    },
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
      toast({
        title: "Sync Complete",
        description: `Synced ${data.orders_fetched} orders with ${data.lines_inserted} lines. ${data.lines_skipped} lines skipped (no brand match).`,
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
          <h1 className="text-3xl font-bold">Sales Orders</h1>
          <p className="text-muted-foreground mt-2">
            Sync and view order lines from Mintsoft
          </p>
        </div>
        <Button 
          onClick={handleSync} 
          disabled={isSyncing}
          size="lg"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
          Sync Mintsoft Orders (Last 1 Day)
        </Button>
      </div>

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
    </div>
  );
};

export default SalesOrders;
