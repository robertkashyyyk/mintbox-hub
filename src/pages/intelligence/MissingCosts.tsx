import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * Two-mode view:
 *  1) "active" — every product in cache without a cost_price (housekeeping list)
 *  2) Banner — recent order lines that fired without cost (immediate profit risk)
 */
const MissingCosts = () => {
  const { data: catalog, isLoading: loadingCatalog } = useQuery({
    queryKey: ["missing-costs-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_cache")
        .select("id, sku, name, suppliers, current_stock, brand_id")
        .is("cost_price", null)
        .eq("discontinued", false)
        .eq("quarantined", false)
        .order("current_stock", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: recentImpact, isLoading: loadingImpact } = useQuery({
    queryKey: ["missing-costs-recent-orders"],
    queryFn: async () => {
      const since = new Date(Date.now() - 28 * 86400000).toISOString();
      const { data, error } = await supabase
        .from("order_line_economics")
        .select("sku")
        .eq("missing_cost", true)
        .gte("order_date", since)
        .limit(2000);
      if (error) throw error;
      const set = new Set((data ?? []).map((r: any) => r.sku));
      return { unique: set.size, lines: data?.length ?? 0 };
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <AlertCircle className="h-6 w-6 text-destructive" />
          Missing Cost Prices
        </h1>
        <p className="text-sm text-foreground/60 mt-1">
          Without a cost price we cannot compute profit. These are the highest-impact items to fix.
        </p>
      </div>

      <Card className="border-destructive/40">
        <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm">
            {loadingImpact ? (
              <Skeleton className="h-5 w-64" />
            ) : (
              <>
                <span className="font-semibold text-destructive">{recentImpact?.unique ?? 0}</span> SKUs sold in the last 28 days have no cost set
                <span className="text-foreground/60"> ({recentImpact?.lines ?? 0} order lines).</span>
              </>
            )}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/intelligence/profit">Open Profit dashboard</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catalogue items without cost</CardTitle>
          <CardDescription>
            {loadingCatalog ? "Loading…" : `${catalog?.length ?? 0} active SKUs (showing first 500, sorted by stock).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingCatalog ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (catalog?.length ?? 0) === 0 ? (
            <div className="text-sm text-foreground/60 py-6 text-center">All active products have cost prices ✓</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Suppliers</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalog!.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell className="max-w-md truncate">{p.name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-foreground/70">{p.suppliers ?? "—"}</TableCell>
                      <TableCell className="text-right">{p.current_stock ?? 0}</TableCell>
                      <TableCell>
                        <Button asChild variant="ghost" size="sm">
                          <Link to={`/discovery/products/${p.id}`}>Edit</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MissingCosts;
