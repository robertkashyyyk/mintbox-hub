import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { ArrowUpDown, Download } from "lucide-react";
import { useBuyRecommendations } from "@/hooks/useBuyRecommendations";
import { BuyRecommendationFilters } from "@/components/decisions/BuyRecommendationFilters";

const BuyRecommendations = () => {
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
    exportToCSV,
  } = useBuyRecommendations();

  const totalPages = Math.ceil(totalCount / pageSize);

  const getPriorityBadge = (qty: number) => {
    if (qty >= 25) {
      return <Badge variant="destructive">High</Badge>;
    }
    if (qty >= 10) {
      return <Badge className="bg-orange-500 hover:bg-orange-600">Medium</Badge>;
    }
    if (qty >= 3) {
      return <Badge className="bg-yellow-500 hover:bg-yellow-600">Low</Badge>;
    }
    return <Badge variant="secondary">Very Low</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Buy Recommendations</h2>
          <p className="text-white/60">
            Velocity-based purchase order suggestions. Advisory only.
          </p>
        </div>
        <Button onClick={exportToCSV} disabled={loading || data.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          Export to CSV
        </Button>
      </div>

      <BuyRecommendationFilters filters={filters} onFiltersChange={handleFiltersChange} />

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button
                  className="flex items-center gap-1 font-medium"
                  onClick={() => handleSort("sku")}
                >
                  SKU
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  className="flex items-center gap-1 font-medium"
                  onClick={() => handleSort("brand_id")}
                >
                  Brand
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  className="flex items-center gap-1 font-medium"
                  onClick={() => handleSort("avg_weekly_units")}
                >
                  Avg/week
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  className="flex items-center gap-1 font-medium"
                  onClick={() => handleSort("on_hand_qty")}
                >
                  Current Stock
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  className="flex items-center gap-1 font-medium"
                  onClick={() => handleSort("target_stock")}
                >
                  Target Stock
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  className="flex items-center gap-1 font-medium"
                  onClick={() => handleSort("recommended_purchase_qty")}
                >
                  Recommended Qty
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead>
                <button
                  className="flex items-center gap-1 font-medium"
                  onClick={() => handleSort("weeks_of_cover")}
                >
                  Weeks of Cover
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead>Priority</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No recommendations found
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow key={row.sku}>
                  <TableCell>
                    <Link
                      to={`/discovery/products/${row.sku}`}
                      className="text-primary hover:underline"
                    >
                      {row.sku}
                    </Link>
                  </TableCell>
                  <TableCell>{row.brand_name}</TableCell>
                  <TableCell>{row.avg_weekly_units.toFixed(2)}</TableCell>
                  <TableCell>{row.on_hand_qty}</TableCell>
                  <TableCell>{row.target_stock.toFixed(0)}</TableCell>
                  <TableCell className="font-semibold">{row.recommended_purchase_qty.toFixed(0)}</TableCell>
                  <TableCell>{row.weeks_of_cover.toFixed(1)}</TableCell>
                  <TableCell>{getPriorityBadge(row.recommended_purchase_qty)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} results
          </p>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setPage(Math.max(1, page - 1))}
                  className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                />
              </PaginationItem>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNum = i + 1;
                return (
                  <PaginationItem key={pageNum}>
                    <PaginationLink
                      onClick={() => setPage(pageNum)}
                      isActive={page === pageNum}
                      className="cursor-pointer"
                    >
                      {pageNum}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}
              <PaginationItem>
                <PaginationNext
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
};

export default BuyRecommendations;
