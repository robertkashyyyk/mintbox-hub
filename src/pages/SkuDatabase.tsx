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
                    <TableHead>Barcode Type</TableHead>
                    <TableHead>Discontinued</TableHead>
                    <TableHead>Categories</TableHead>
                    <TableHead>Suppliers</TableHead>
                    <TableHead>Low Stock Alert</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead>Height</TableHead>
                    <TableHead>Length</TableHead>
                    <TableHead>Depth</TableHead>
                    <TableHead>Cost Price</TableHead>
                    <TableHead>Handling Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => {
                    const categories = product.product_category_links
                      ?.map((link: any) => link.product_categories?.name)
                      .filter(Boolean)
                      .join(", ") || "—";
                    
                    return (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium">
                          {product.sku}
                        </TableCell>
                        <TableCell>{product.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.barcode || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.barcode_types?.type_name || "—"}
                        </TableCell>
                        <TableCell>
                          {product.discontinued ? (
                            <span className="text-destructive">Yes</span>
                          ) : (
                            <span className="text-muted-foreground">No</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {categories}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.suppliers || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.low_stock_alert_level || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.weight || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.height || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.length || "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.depth || "—"}
                        </TableCell>
                        <TableCell>
                          {product.cost_price
                            ? `£${Number(product.cost_price).toFixed(2)}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {product.handling_time || "—"}
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
