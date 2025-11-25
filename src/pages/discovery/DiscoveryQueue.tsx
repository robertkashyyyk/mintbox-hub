import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

const DiscoveryQueue = () => {
  const navigate = useNavigate();

  const { data: products, isLoading } = useQuery({
    queryKey: ["products-needs-enrichment"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_needs_enrichment")
        .select("*")
        .order("discovered_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Product Discovery Queue</h2>
        <p className="text-muted-foreground">
          Products discovered from orders that need enrichment (cost price, stock info, or categories).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Products Needing Enrichment</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : products && products.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Discovered</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Missing Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => {
                  const missingFields = [];
                  if (!product.cost_price) missingFields.push("Cost Price");
                  if (!product.current_stock && product.current_stock !== 0) missingFields.push("Stock");
                  
                  return (
                    <TableRow
                      key={product.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/discovery/products/${product.id}`)}
                    >
                      <TableCell className="font-medium">{product.sku}</TableCell>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>
                        {product.discovered_at
                          ? new Date(product.discovered_at).toLocaleDateString()
                          : "Unknown"}
                      </TableCell>
                      <TableCell>
                        <span className="capitalize">{product.discovery_source || "Unknown"}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-amber-600 dark:text-amber-400 text-sm">
                          {missingFields.join(", ")}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No products in the discovery queue.</p>
              <p className="text-sm">All discovered products have been enriched.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DiscoveryQueue;
