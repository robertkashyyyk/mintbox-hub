import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Clock, CheckCircle2, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

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

  // Get enrichment stats
  const { data: enrichmentStats } = useQuery({
    queryKey: ["enrichment-stats"],
    queryFn: async () => {
      // Get total products needing enrichment
      const { count: needsEnrichmentCount } = await supabase
        .from("products_needs_enrichment")
        .select("*", { count: "exact", head: true });

      // Get last enrichment run info
      const { data: ingestState } = await supabase
        .from("ingest_run_state")
        .select("*")
        .eq("id", "mintsoft_enrich_batch")
        .maybeSingle();

      // Get products enriched today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const { count: enrichedTodayCount } = await supabase
        .from("products_cache")
        .select("*", { count: "exact", head: true })
        .gte("last_stock_sync", today.toISOString())
        .not("discovery_source", "is", null);

      return {
        needsEnrichment: needsEnrichmentCount || 0,
        lastRunAt: ingestState?.last_run_at,
        lastStatus: ingestState?.last_status,
        enrichedToday: enrichedTodayCount || 0,
      };
    },
  });

  const getSourceBadge = (source: string | null) => {
    switch (source) {
      case "order":
        return <Badge variant="secondary">From Order</Badge>;
      case "catalog_import":
        return <Badge variant="outline">Catalog Import</Badge>;
      case "mintsoft_pull":
        return <Badge variant="outline">Mintsoft Pull</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white">Product Discovery Queue</h2>
        <p className="text-white/60">
          Products discovered from orders or catalog imports that need enrichment (cost price, stock info, or categories).
        </p>
      </div>

      {/* Enrichment Progress Stats */}
      {enrichmentStats && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Awaiting Enrichment</p>
                  <p className="text-2xl font-bold">{enrichmentStats.needsEnrichment.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Enriched Today</p>
                  <p className="text-2xl font-bold">{enrichmentStats.enrichedToday}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <RefreshCw className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Last Enrichment Run</p>
                  <p className="text-lg font-medium">
                    {enrichmentStats.lastRunAt 
                      ? formatDistanceToNow(new Date(enrichmentStats.lastRunAt), { addSuffix: true })
                      : "Never"
                    }
                  </p>
                  {enrichmentStats.lastStatus && (
                    <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {enrichmentStats.lastStatus}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
                  if (!product.last_stock_sync) missingFields.push("Not Synced");
                  
                  return (
                    <TableRow
                      key={product.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/discovery/products/${product.id}`)}
                    >
                      <TableCell className="font-medium">{product.sku}</TableCell>
                      <TableCell className="max-w-[300px] truncate">{product.name}</TableCell>
                      <TableCell>
                        {product.discovered_at
                          ? new Date(product.discovered_at).toLocaleDateString()
                          : "Unknown"}
                      </TableCell>
                      <TableCell>
                        {getSourceBadge(product.discovery_source)}
                      </TableCell>
                      <TableCell>
                        <span className="text-amber-600 dark:text-amber-400 text-sm">
                          {missingFields.join(", ") || "Pending sync"}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500 opacity-50" />
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
