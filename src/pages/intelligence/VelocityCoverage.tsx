import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageLoader } from "@/components/ui/PageLoader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, ChevronLeft, ChevronRight, TrendingUp, Download, Loader2 } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { useSkuVelocity } from "@/hooks/useSkuVelocity";
import { VelocityFilters } from "@/components/intelligence/VelocityFilters";
import { Link } from "react-router-dom";

const VelocityCoverage = () => {
  const {
    items,
    totalCount,
    filteredCount,
    isLoading,
    page,
    setPage,
    pageSize,
    sort,
    handleSortChange,
    filters,
    handleFiltersChange,
    brands,
    suppliers,
    getBrandName,
    exportToCsv,
    exporting,
  } = useSkuVelocity();

  const totalPages = Math.ceil(filteredCount / pageSize);

  const SortableHeader = ({ field, label }: { field: any; label: string }) => (
    <TableHead>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleSortChange(field)}
        className="h-8 px-2"
      >
        {label}
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    </TableHead>
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Velocity & Coverage"
        description="Sales velocity analysis showing product movement over 30, 60, and 90-day periods."
        icon={TrendingUp}
      />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>SKU Sales Velocity</CardTitle>
            <CardDescription>
              Showing {filteredCount.toLocaleString()} of {totalCount.toLocaleString()} SKUs
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={exportToCsv} disabled={exporting || filteredCount === 0}>
            {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            Export CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <VelocityFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
            brands={brands}
            suppliers={suppliers}
          />

          {isLoading ? (
            <PageLoader rows={10} columns={[160, 120, 90, 90, 90, 90]} label="Loading velocity" />
          ) : (
          <div className="rounded-md border [&>div]:max-h-[70vh] [&>div]:overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow>
                  <SortableHeader field="sku" label="SKU" />
                  <TableHead>Brand</TableHead>
                  <SortableHeader field="units_30d" label="Units 30d" />
                  <SortableHeader field="units_60d" label="Units 60d" />
                  <SortableHeader field="units_90d" label="Units 90d" />
                  <SortableHeader field="avg_weekly_units" label="Avg/Week" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No velocity data found
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.sku}>
                      <TableCell>
                        <Link
                          to={`/discovery/products/${item.sku}`}
                          className="text-primary hover:underline font-medium"
                        >
                          {item.sku}
                        </Link>
                      </TableCell>
                      <TableCell>{getBrandName(item.brand_id)}</TableCell>
                      <TableCell className="text-right">
                        {item.units_30d?.toLocaleString() || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.units_60d?.toLocaleString() || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.units_90d?.toLocaleString() || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.avg_weekly_units === 0 || item.avg_weekly_units === null ? (
                          <Badge variant="secondary" className="text-muted-foreground">
                            No sales
                          </Badge>
                        ) : (
                          <span className="font-medium">
                            {item.avg_weekly_units.toFixed(2)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default VelocityCoverage;
