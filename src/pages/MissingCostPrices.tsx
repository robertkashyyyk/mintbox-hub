import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";

const MissingCostPrices = () => {
  const { data: products, isLoading } = useQuery({
    queryKey: ["missing-cost-prices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_cache")
        .select("id, sku, name, suppliers, current_stock, discontinued")
        .is("cost_price", null)
        .eq("discontinued", false)
        .order("sku");

      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <AlertCircle className="h-8 w-8 text-orange-500" />
        <div>
          <h1 className="text-3xl font-bold">Missing Cost Prices</h1>
          <p className="text-muted-foreground">Products without cost prices configured</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Products Missing Cost Prices</CardTitle>
          <CardDescription>
            {products ? `${products.length} product(s) found without cost prices` : "Loading..."}
          </CardDescription>
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
                    <TableHead>Suppliers</TableHead>
                    <TableHead>Current Stock</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">{product.sku}</TableCell>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>{product.suppliers || "—"}</TableCell>
                      <TableCell>{product.current_stock || 0}</TableCell>
                      <TableCell>
                        <Badge variant={product.discontinued ? "secondary" : "default"}>
                          {product.discontinued ? "Discontinued" : "Active"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No products found without cost prices
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MissingCostPrices;
