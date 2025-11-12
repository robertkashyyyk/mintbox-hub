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

const Brands = () => {
  const { data: brands, isLoading } = useQuery({
    queryKey: ["brands-with-count"],
    queryFn: async () => {
      // Fetch brands
      const { data: brandsData, error: brandsError } = await supabase
        .from("brands")
        .select("*")
        .order("name");

      if (brandsError) throw brandsError;

      // For each brand, count products in products_cache
      const brandsWithCount = await Promise.all(
        (brandsData || []).map(async (brand) => {
          const separator = brand.prefix_style === "slash" ? "/" : "-";
          const prefixPattern = `${brand.prefix}${separator}%`;

          const { count, error } = await supabase
            .from("products_cache")
            .select("*", { count: "exact", head: true })
            .ilike("sku", prefixPattern);

          if (error) {
            console.error(`Error counting products for ${brand.name}:`, error);
            return { ...brand, product_count: 0 };
          }

          return { ...brand, product_count: count || 0 };
        })
      );

      return brandsWithCount;
    },
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Brands</h1>
        <p className="text-muted-foreground">
          Manage brands and view product counts
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Brands ({brands?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brand Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Prefix Style</TableHead>
                  <TableHead>Family</TableHead>
                  <TableHead className="text-right">Product Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {brands?.map((brand) => (
                  <TableRow key={brand.id}>
                    <TableCell className="font-medium">{brand.name}</TableCell>
                    <TableCell>{brand.prefix}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2 py-1 rounded-md bg-muted text-xs">
                        {brand.prefix_style === "slash" ? "/" : "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {brand.family ? (
                        <span className="text-muted-foreground">{brand.family}</span>
                      ) : (
                        <span className="text-muted-foreground italic">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {brand.product_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Brands;
