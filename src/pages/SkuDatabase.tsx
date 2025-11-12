import { useQuery } from "@tanstack/react-query";
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

const SkuDatabase = () => {
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
          discontinued,
          suppliers,
          cost_price,
          created_at
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">SKU Database</h1>
        <p className="text-muted-foreground mt-2">
          View all products in the database
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Products ({products?.length || 0})</CardTitle>
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
                    <TableHead>Barcode</TableHead>
                    <TableHead>Suppliers</TableHead>
                    <TableHead>Cost Price</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">
                        {product.sku}
                      </TableCell>
                      <TableCell>{product.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {product.barcode || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {product.suppliers || "—"}
                      </TableCell>
                      <TableCell>
                        {product.cost_price
                          ? `£${Number(product.cost_price).toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {product.discontinued ? (
                          <span className="text-destructive">Discontinued</span>
                        ) : (
                          <span className="text-muted-foreground">Active</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
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
