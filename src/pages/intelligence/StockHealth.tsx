import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Activity } from "lucide-react";
import { StockHealthFilters } from "@/components/intelligence/StockHealthFilters";
import { useStockHealth } from "@/hooks/useStockHealth";
import { Link } from "react-router-dom";

const getHealthBadgeVariant = (category: string) => {
  const colorMap: Record<string, { bg: string; text: string; border?: string }> = {
    "Extreme Overstock": { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-800 dark:text-purple-300" },
    "Overstock": { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-800 dark:text-blue-300" },
    "Unhealthy": { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-300" },
    "Healthy": { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-800 dark:text-green-300" },
    "Low Stock": { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-800 dark:text-orange-300" },
    "Critical": { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-800 dark:text-red-300" },
    "Dead Stock": { bg: "bg-gray-100 dark:bg-gray-900/30", text: "text-gray-800 dark:text-gray-300" },
    "Out of Stock": { bg: "bg-gray-200 dark:bg-gray-800/50", text: "text-gray-900 dark:text-gray-400" },
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Stock Health</h2>
        <p className="text-muted-foreground">
          Stock levels, overstock, and shortage analysis powered by sales velocity.
        </p>
      </div>

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
