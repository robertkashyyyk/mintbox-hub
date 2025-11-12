import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

const SkuDatabase = () => {
  const queryClient = useQueryClient();

  const { data: products, isLoading } = useQuery({
    queryKey: ["products-cache"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_cache")
        .select(`
          id,
          sku,
          name,
          barcode,
          barcode_type_id,
          barcode_types (type_name),
          discontinued,
          suppliers,
          low_stock_alert_level,
          weight,
          height,
          length,
          depth,
          cost_price,
          handling_time,
          current_stock,
          back_order_qty,
          on_order,
          last_stock_sync,
          created_at,
          product_category_links (
            product_categories (name)
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Mutation to sync stock from Mintsoft
  const syncStockMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sync-mintsoft-stock");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(data.message || "Stock synced successfully");
      queryClient.invalidateQueries({ queryKey: ["products-cache"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to sync stock: ${error.message}`);
    },
  });

  const calculateQuantityToOrder = (product: any) => {
    const backOrder = Number(product.back_order_qty) || 0;
    const currentStock = Number(product.current_stock) || 0;
    const lowStockLevel = Number(product.low_stock_alert_level) || 0;
    const onOrder = Number(product.on_order) || 0;

    const needed = Math.max(lowStockLevel - currentStock, 0);
    const total = backOrder + needed - onOrder;
    
    return Math.max(total, 0);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">SKU Database</h1>
        <p className="text-muted-foreground mt-2">
          View all products in the database
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle>Products ({products?.length || 0})</CardTitle>
          <Button
            onClick={() => syncStockMutation.mutate()}
            disabled={syncStockMutation.isPending}
            variant="outline"
            size="sm"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncStockMutation.isPending ? 'animate-spin' : ''}`} />
            {syncStockMutation.isPending ? "Syncing..." : "Sync Stock"}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : products && products.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Current Stock</TableHead>
                    <TableHead>Back Orders</TableHead>
                    <TableHead>On Order</TableHead>
                    <TableHead>Low Stock Alert</TableHead>
                    <TableHead>Qty to Order</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Barcode Type</TableHead>
                    <TableHead>Categories</TableHead>
                    <TableHead>Cost Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Synced</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product: any) => {
                    const categories = product.product_category_links
                      ?.map((link: any) => link.product_categories?.name)
                      .filter(Boolean)
                      .join(", ") || "—";
                    
                    const qtyToOrder = calculateQuantityToOrder(product);
                    const needsOrdering = qtyToOrder > 0;
                    
                    return (
                      <TableRow key={product.id} className={needsOrdering ? "bg-yellow-50 dark:bg-yellow-950/20" : ""}>
                        <TableCell className="font-medium">
                          {product.sku}
                        </TableCell>
                        <TableCell>{product.name}</TableCell>
                        <TableCell className="text-center">
                          <span className={Number(product.current_stock) <= Number(product.low_stock_alert_level) ? "text-destructive font-semibold" : ""}>
                            {product.current_stock || 0}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {product.back_order_qty || 0}
                        </TableCell>
                        <TableCell className="text-center">
                          {product.on_order || 0}
                        </TableCell>
                        <TableCell className="text-center">
                          {product.low_stock_alert_level || 0}
                        </TableCell>
                        <TableCell className="text-center">
                          {needsOrdering ? (
                            <span className="font-bold text-destructive">
                              {qtyToOrder}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.barcode || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.barcode_types?.type_name || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {categories}
                        </TableCell>
                        <TableCell>
                          {product.cost_price
                            ? `£${Number(product.cost_price).toFixed(2)}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {product.discontinued ? (
                            <span className="text-destructive">Yes</span>
                          ) : (
                            <span className="text-muted-foreground">No</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {product.last_stock_sync
                            ? new Date(product.last_stock_sync).toLocaleString()
                            : "Never"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No products found in the database
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SkuDatabase;
