import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { format } from "date-fns";

const ProblematicOrders = () => {
  const { data: orders, isLoading } = useQuery({
    queryKey: ["problematic-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_tracking")
        .select(`
          id,
          order_date,
          placed,
          created_at,
          brands (name)
        `)
        .eq("placed", false)
        .order("order_date", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-8 w-8 text-red-500" />
        <div>
          <h1 className="text-3xl font-bold text-white">Problematic Orders</h1>
          <p className="text-white/60">Orders that have not been placed</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unplaced Orders</CardTitle>
          <CardDescription>
            {orders ? `${orders.length} order(s) pending placement` : "Loading..."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : orders && orders.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Brand</TableHead>
                    <TableHead>Order Date</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        {order.brands?.name || "Unknown"}
                      </TableCell>
                      <TableCell>
                        {format(new Date(order.order_date), "PPP")}
                      </TableCell>
                      <TableCell>
                        {format(new Date(order.created_at), "PPP")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive">Not Placed</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No problematic orders found
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ProblematicOrders;
