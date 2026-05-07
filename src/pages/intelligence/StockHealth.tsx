import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Activity, RefreshCw } from "lucide-react";
import { StockHealthFilters } from "@/components/intelligence/StockHealthFilters";
import { useStockHealth } from "@/hooks/useStockHealth";
import { Link } from "react-router-dom";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const getHealthBadgeVariant = (category: string) => {
  const colorMap: Record<string, { bg: string; text: string; border?: string }> = {
    "Extreme Overstock": { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-800 dark:text-purple-300" },
    "Overstock": { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-800 dark:text-blue-300" },
    "Unhealthy": { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-300" },
    "Healthy": { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-800 dark:text-green-300" },
    "Low Stock": { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-800 dark:text-orange-300" },
    "Critical": { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-800 dark:text-red-300" },
    "Dead Stock": { bg: "bg-muted dark:bg-card/30", text: "text-foreground dark:text-muted-foreground" },
    "Out of Stock": { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-800 dark:text-red-300" },
    "Non Selling": { bg: "bg-muted dark:bg-card/30", text: "text-foreground/70 dark:text-muted-foreground" },
    "Missing Baseline": { bg: "bg-background", text: "text-red-600 dark:text-red-400", border: "border-red-600 dark:border-red-400" },
  };

  const colors = colorMap[category] || { bg: "bg-muted", text: "text-muted-foreground" };
  
  if (category === "Missing Baseline") {
    return `${colors.bg} ${colors.text} border-2 ${colors.border}`;
  }
  
  return `${colors.bg} ${colors.text}`;
};

const StockHealth = () => {
  const {
    data,
    loading,
    totalCount,
    summary,
    dirtSkusCount,
    page,
    pageSize,
    setPage,
    filters,
    handleFiltersChange,
    sortBy,
    sortOrder,
    handleSort,
  } = useStockHealth();

  const totalPages = Math.ceil(totalCount / pageSize);

  const SortableHeader = ({ column, label }: { column: string; label: string }) => (
    <TableHead 
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => handleSort(column)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortBy === column && (
          <span className="text-xs">{sortOrder === "asc" ? "↑" : "↓"}</span>
        )}
      </div>
    </TableHead>
  );

  const [refreshing, setRefreshing] = useState(false);
  const handleRefreshSnapshot = async () => {
    setRefreshing(true);
    try {
      const { error } = await supabase.rpc("refresh_sku_health_now" as any);
      if (error) throw error;
      toast.success("Stock health snapshot refreshed — reloading…");
      setTimeout(() => window.location.reload(), 600);
    } catch (e: any) {
      toast.error(`Refresh failed: ${e?.message ?? e}`);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Stock Health</h2>
          <p className="text-foreground/60">
            Stock levels, overstock, and shortage analysis powered by sales velocity.
          </p>
          <p className="text-xs text-foreground/50 mt-1">
            Snapshot auto-refreshes daily at 06:30 UTC. Use Refresh now after editing brand base multipliers.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefreshSnapshot} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh now"}
        </Button>
      </div>

      {/* Top-level KPI cards. Click a category card to filter the table below. */}
      {summary && (() => {
        const cat = summary.byCategory ?? {};
        const healthy = cat["Healthy"] ?? 0;
        const problemKeys = ["Unhealthy", "Low Stock", "Critical", "Out of Stock", "Dead Stock"];
        const overstockKeys = ["Overstock", "Extreme Overstock"];
        const problems = problemKeys.reduce((s, k) => s + (cat[k] ?? 0), 0);
        const overstock = overstockKeys.reduce((s, k) => s + (cat[k] ?? 0), 0);
        const nonSelling = cat["Non Selling"] ?? 0;
        const missingBaseline = cat["Missing Baseline"] ?? 0;
        const total = summary.totalSkus || 1;
        const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;

        const tiles: Array<{
          label: string;
          value: string;
          sub?: string;
          tone: string;
          onClick?: () => void;
          active?: boolean;
        }> = [
          {
            label: "SKUs in scope",
            value: summary.totalSkus.toLocaleString(),
            sub: filters.excludeDirt ? "DIRT excluded" : `${dirtSkusCount.toLocaleString()} DIRT in catalog`,
            tone: "border-border bg-card",
          },
          {
            label: "Healthy",
            value: healthy.toLocaleString(),
            sub: pct(healthy),
            tone: "border-green-600/40 bg-green-500/10",
            onClick: () => handleFiltersChange({ healthCategory: filters.healthCategory === "Healthy" ? "all" : "Healthy", onlyProblems: false }),
            active: filters.healthCategory === "Healthy",
          },
          {
            label: "Problems",
            value: problems.toLocaleString(),
            sub: pct(problems),
            tone: "border-destructive/40 bg-destructive/10",
            onClick: () => handleFiltersChange({ onlyProblems: !filters.onlyProblems, healthCategory: "all" }),
            active: filters.onlyProblems,
          },
          {
            label: "Overstock",
            value: overstock.toLocaleString(),
            sub: pct(overstock),
            tone: "border-blue-500/40 bg-blue-500/10",
          },
          {
            label: "DIRT in scope",
            value: summary.dirtSkus.toLocaleString(),
            sub: filters.excludeDirt ? "filter active" : "click to exclude",
            tone: "border-warning/50 bg-warning/10",
            onClick: () => handleFiltersChange({ excludeDirt: !filters.excludeDirt }),
            active: filters.excludeDirt,
          },
          {
            label: "Total on-hand units",
            value: Math.round(summary.totalOnHand).toLocaleString(),
            tone: "border-border bg-card",
          },
        ];

        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {tiles.map((t) => {
              const isButton = !!t.onClick;
              const Comp: any = isButton ? "button" : "div";
              return (
                <Comp
                  key={t.label}
                  type={isButton ? "button" : undefined}
                  onClick={t.onClick}
                  className={`text-left rounded-md border-2 p-3 transition ${t.tone} ${isButton ? "hover:brightness-125 cursor-pointer focus:outline-none focus:ring-2 focus:ring-pd-accent" : ""} ${t.active ? "ring-2 ring-pd-accent" : ""}`}
                >
                  <div className="text-xs uppercase tracking-wide text-foreground/60">{t.label}</div>
                  <div className="text-2xl font-bold mt-1 text-foreground">{t.value}</div>
                  {t.sub && <div className="text-xs mt-0.5 text-foreground/70">{t.sub}</div>}
                </Comp>
              );
            })}
          </div>
        );
      })()}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-500" />
            <CardTitle>Stock Health Analysis</CardTitle>
          </div>
          <CardDescription>
            Showing {data.length} of {totalCount} SKUs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <StockHealthFilters filters={filters} onFiltersChange={handleFiltersChange} />

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading stock health data...</div>
          ) : data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No stock health data found</div>
          ) : (
            <>
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHeader column="sku" label="SKU" />
                      <SortableHeader column="brand_id" label="Brand" />
                      <SortableHeader column="avg_weekly_units" label="Avg/week" />
                      <SortableHeader column="on_hand_qty" label="Stock" />
                      <SortableHeader column="weeks_of_cover" label="Weeks of Cover" />
                      <SortableHeader column="base_multiplier" label="Base Multiplier" />
                      <SortableHeader column="health_category" label="Health Category" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((row) => (
                      <TableRow key={row.sku}>
                        <TableCell>
                          <Link 
                            to={`/discovery/products/${row.sku}`}
                            className="text-primary hover:underline font-medium"
                          >
                            {row.sku}
                          </Link>
                        </TableCell>
                        <TableCell>{row.brand_name}</TableCell>
                        <TableCell>{row.avg_weekly_units?.toFixed(2) || "0.00"}</TableCell>
                        <TableCell>{row.on_hand_qty || 0}</TableCell>
                        <TableCell>
                          {row.weeks_of_cover !== null ? row.weeks_of_cover.toFixed(1) : "—"}
                        </TableCell>
                        <TableCell>
                          {row.base_multiplier ? `${row.base_multiplier}x` : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge className={getHealthBadgeVariant(row.health_category)}>
                            {row.health_category}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page - 1)}
                      disabled={page === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page + 1)}
                      disabled={page === totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StockHealth;
