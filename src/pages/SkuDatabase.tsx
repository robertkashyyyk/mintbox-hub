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
import { Button } from "@/components/ui/button";
import { SkuFilters } from "@/components/sku-database/SkuFilters";
import { useSkuDatabase } from "@/hooks/useSkuDatabase";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { ArrowUpDown, Download } from "lucide-react";
import { toast } from "sonner";

const SkuDatabase = () => {
  const {
    products,
    totalCount,
    filteredCount,
    isLoading,
    page,
    setPage,
    totalPages,
    sort,
    handleSortChange,
    filters,
    handleFiltersChange,
    brands,
    getBrandFromSku,
  } = useSkuDatabase();

  const calculateQuantityToOrder = (product: any) => {
    const backOrder = Number(product.back_order_qty) || 0;
    const currentStock = Number(product.current_stock) || 0;
    const lowStockLevel = Number(product.low_stock_alert_level) || 0;
    const onOrder = Number(product.on_order) || 0;

    const needed = Math.max(lowStockLevel - currentStock, 0);
    const total = backOrder + needed - onOrder;
    
    return Math.max(total, 0);
  };

  const exportToCSV = () => {
    if (!products || products.length === 0) {
      toast.error("No data to export");
      return;
    }

    const headers = [
      "SKU",
      "Mintsoft ID",
      "Brand",
      "Name",
      "Current Stock",
      "Back Orders",
      "On Order",
      "Low Stock Alert",
      "Qty to Order",
      "Barcode",
      "Barcode Type",
      "Categories",
      "Cost Price",
      "Status",
      "Last Synced",
    ];

    const csvData = products.map((product: any) => {
      const categories = product.product_category_links
        ?.map((link: any) => link.product_categories?.name)
        .filter(Boolean)
        .join("; ") || "";
      
      const qtyToOrder = calculateQuantityToOrder(product);
      const brandName = getBrandFromSku(product.sku);

      return [
        product.sku,
        product.mintsoft_product_id || "",
        brandName || "",
        product.name,
        product.current_stock || 0,
        product.back_order_qty || 0,
        product.on_order || 0,
        product.low_stock_alert_level || 0,
        qtyToOrder,
        product.barcode || "",
        product.barcode_types?.type_name || "",
        categories,
        product.cost_price ? `£${Number(product.cost_price).toFixed(2)}` : "",
        product.discontinued ? "Discontinued" : "Active",
        product.last_stock_sync
          ? new Date(product.last_stock_sync).toLocaleString()
          : "Never",
      ];
    });

    const csvContent = [
      headers.join(","),
      ...csvData.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `sku-database-${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success(`Exported ${products.length} products to CSV`);
  };

  const SortableHeader = ({ field, children }: { field: any; children: React.ReactNode }) => (
    <TableHead>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 -ml-3"
        onClick={() => handleSortChange(field)}
      >
        {children}
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    </TableHead>
  );

  const uniqueCategories = Array.from(
    new Set(
      products.flatMap((p: any) =>
        p.product_category_links?.map((link: any) => link.product_categories?.name).filter(Boolean) || []
      )
    )
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">SKU Database</h1>
          <p className="text-muted-foreground mt-2">
            Showing {filteredCount} of {totalCount} products
          </p>
        </div>
        <Button onClick={exportToCSV} disabled={isLoading || products.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          Export Filtered View
        </Button>
      </div>

      <SkuFilters
        filters={filters}
        onFiltersChange={handleFiltersChange}
        brands={brands}
        categories={uniqueCategories}
      />

      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : products && products.length > 0 ? (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHeader field="sku">SKU</SortableHeader>
                      <TableHead>Mintsoft ID</TableHead>
                      <SortableHeader field="brand">Brand</SortableHeader>
                      <SortableHeader field="name">Name</SortableHeader>
                      <SortableHeader field="current_stock">Current Stock</SortableHeader>
                      <SortableHeader field="back_order_qty">Back Orders</SortableHeader>
                      <SortableHeader field="on_order">On Order</SortableHeader>
                      <SortableHeader field="low_stock_alert_level">Low Stock Alert</SortableHeader>
                      <TableHead>Qty to Order</TableHead>
                      <TableHead>Barcode</TableHead>
                      <TableHead>Barcode Type</TableHead>
                      <TableHead>Categories</TableHead>
                      <SortableHeader field="cost_price">Cost Price</SortableHeader>
                      <TableHead>Status</TableHead>
                      <SortableHeader field="last_stock_sync">Last Synced</SortableHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product: any) => {
                      const categories = product.product_category_links
                        ?.map((link: any) => link.product_categories?.name)
                        .filter(Boolean)
                        .join(", ") || "—";
                      
                      const qtyToOrder = calculateQuantityToOrder(product);
                      const needsOrdering = qtyToOrder > 0;
                      const brandName = getBrandFromSku(product.sku);
                      
                      return (
                        <TableRow key={product.id} className={needsOrdering ? "bg-accent/5" : ""}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {product.sku}
                              {product.discovery_source === 'order' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                                  Order-discovered
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {product.mintsoft_product_id || "—"}
                          </TableCell>
                          <TableCell>
                            {brandName ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">
                                {brandName}
                              </span>
                            ) : (
                              <span className="text-muted-foreground italic">—</span>
                            )}
                          </TableCell>
                          <TableCell>{product.name}</TableCell>
                          <TableCell className="text-center">
                            <span className={Number(product.current_stock) <= Number(product.low_stock_alert_level) ? "text-destructive font-semibold" : ""}>
                              {product.current_stock || 0}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            {product.back_order_qty || 0}
                          </TableCell>
                          <TableCell className="text-center">
                            {product.on_order || 0}
                          </TableCell>
                          <TableCell className="text-center">
                            {product.low_stock_alert_level || 0}
                          </TableCell>
                          <TableCell className="text-center">
                            {needsOrdering ? (
                              <span className="font-bold text-destructive">
                                {qtyToOrder}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {product.barcode || "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {product.barcode_types?.type_name || "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {categories}
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
                              <span className="text-success">Active</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {product.last_stock_sync
                              ? new Date(product.last_stock_sync).toLocaleString()
                              : "Never"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="mt-4">
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      
                      {[...Array(Math.min(5, totalPages))].map((_, i) => {
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
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No products found matching your filters
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SkuDatabase;
