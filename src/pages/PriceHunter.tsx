import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play, RotateCcw, ArrowLeft, Eye, CheckSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { BrandAutomationPanel } from "@/components/price-hunter/BrandAutomationPanel";

export default function PriceHunter() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [onlyExpensive, setOnlyExpensive] = useState(false);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [hideExcluded, setHideExcluded] = useState(true);
  const [fireSaleOnly, setFireSaleOnly] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());

  // Fetch brands for filter and matching
  const { data: brands } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, prefix, prefix_style")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Helper function to derive ph_brand and ph_search_term from SKU
  const deriveBrandAndSearchTerm = (sku: string) => {
    if (!brands) return { ph_brand: null, ph_search_term: sku };

    // Find matching brand by prefix
    const matchingBrand = brands.find((brand) => {
      if (!brand.prefix) return false;
      const separator = brand.prefix_style === "slash" ? "/" : "-";
      const pattern = `${brand.prefix}${separator}`;
      return sku.startsWith(pattern);
    });

    if (!matchingBrand) {
      return { ph_brand: null, ph_search_term: sku };
    }

    // Strip the prefix based on prefix_style
    const separator = matchingBrand.prefix_style === "slash" ? "/" : "-";
    const parts = sku.split(separator);
    const searchTerm = parts.length > 1 ? parts.slice(1).join(separator) : sku;

    return {
      ph_brand: matchingBrand.name,
      ph_search_term: searchTerm,
    };
  };

  // Fetch products with PH data
  const { data: products, isLoading } = useQuery({
    queryKey: ["price-hunter-products", brandFilter, statusFilter, onlyExpensive, onlyInStock, hideExcluded, fireSaleOnly],
    queryFn: async () => {
      let query = supabase
        .from("products_cache")
        .select("*")
        .eq("quarantined", false)
        .order("sku");

      if (brandFilter !== "all") {
        query = query.ilike("sku", `${brandFilter}%`);
      }

      if (statusFilter !== "all") {
        query = query.eq("ph_status", statusFilter);
      }

      if (onlyInStock) {
        query = query.gt("current_stock", 0);
      }

      if (hideExcluded) {
        query = query.eq("ph_excluded", false);
      }

      if (fireSaleOnly) {
        query = query.eq("fire_sale", true);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Client-side filter for "only expensive"
      if (onlyExpensive) {
        return data?.filter((p) => {
          const ourPrice = p.ph_our_best_price;
          const plainPrice = p.ph_plain_best_price;
          const brandPrice = p.ph_brand_best_price;
          
          if (!ourPrice) return false;
          
          return (
            (plainPrice && ourPrice > plainPrice) ||
            (brandPrice && ourPrice > brandPrice)
          );
        });
      }
      
      return data;
    },
  });

  // Queue for price check
  const queueMutation = useMutation({
    mutationFn: async (productId: string) => {
      // First fetch the product to get its SKU and current ph fields
      const { data: product, error: fetchError } = await supabase
        .from("products_cache")
        .select("sku, ph_brand, ph_search_term")
        .eq("id", productId)
        .single();

      if (fetchError) throw fetchError;

      // Only auto-populate if fields are null (respect manual overrides)
      const updates: any = {
        ph_status: "queued",
        ph_error_message: null,
      };

      if (!product.ph_brand || !product.ph_search_term) {
        const derived = deriveBrandAndSearchTerm(product.sku);
        if (!product.ph_brand && derived.ph_brand) {
          updates.ph_brand = derived.ph_brand;
        }
        if (!product.ph_search_term && derived.ph_search_term) {
          updates.ph_search_term = derived.ph_search_term;
        }
      }

      const { error } = await supabase
        .from("products_cache")
        .update(updates)
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-hunter-products"] });
      toast({
        title: "Queued",
        description: "Product queued for price check",
      });
    },
  });

  // Reset result
  const resetMutation = useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase
        .from("products_cache")
        .update({
          ph_status: "idle",
          ph_plain_best_price: null,
          ph_plain_best_seller: null,
          ph_plain_best_item_id: null,
          ph_brand_best_price: null,
          ph_brand_best_seller: null,
          ph_brand_best_item_id: null,
          ph_last_checked_at: null,
          ph_error_message: null,
        })
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-hunter-products"] });
      toast({
        title: "Reset",
        description: "Price check data cleared",
      });
    },
  });

  // Queue selected SKUs
  const queueSelectedMutation = useMutation({
    mutationFn: async (productIds: string[]) => {
      const { error } = await supabase
        .from("products_cache")
        .update({
          ph_status: "queued",
          ph_error_message: null,
        })
        .in("id", productIds);
      if (error) throw error;
    },
    onSuccess: (_, productIds) => {
      queryClient.invalidateQueries({ queryKey: ["price-hunter-products"] });
      setSelectedProducts(new Set());
      toast({
        title: "Queued",
        description: `${productIds.length} products queued for price check`,
      });
    },
  });

  const handleSelectAll = (checked: boolean) => {
    if (checked && products) {
      setSelectedProducts(new Set(products.map(p => p.id)));
    } else {
      setSelectedProducts(new Set());
    }
  };

  const handleSelectProduct = (productId: string, checked: boolean) => {
    const newSelected = new Set(selectedProducts);
    if (checked) {
      newSelected.add(productId);
    } else {
      newSelected.delete(productId);
    }
    setSelectedProducts(newSelected);
  };

  const handleQueueSelected = () => {
    if (selectedProducts.size > 0) {
      queueSelectedMutation.mutate(Array.from(selectedProducts));
    }
  };

  const handleQueueAll = () => {
    if (products && products.length > 0) {
      queueSelectedMutation.mutate(products.map(p => p.id));
    }
  };

  // Get selected brand details
  const selectedBrand = brands?.find(
    (b) => brandFilter !== "all" && (b.prefix === brandFilter || b.name === brandFilter)
  );

  const getStatusBadge = (status: string | null) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      idle: "outline",
      queued: "secondary",
      running: "default",
      done: "default",
      error: "destructive",
    };
    return (
      <Badge variant={variants[status || "idle"] || "outline"}>
        {status || "idle"}
      </Badge>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-pd-accent hover:text-pd-accent-light"
            onClick={() => navigate("/execution")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Execution
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Price Hunter – Queue & Results</h1>
            <p className="text-foreground/60">
              Manage eBay price checks and view results
            </p>
          </div>
        </div>
      </div>

      {/* API Endpoint Documentation */}
      <Card className="p-4 bg-muted/50">
        <h3 className="font-semibold mb-2">n8n API Endpoints</h3>
        <div className="space-y-1 text-sm font-mono">
          <p>
            <strong>GET</strong> /functions/v1/fetch-queued-price-checks
          </p>
          <p>
            <strong>POST</strong> /functions/v1/update-price-check-results
          </p>
        </div>
      </Card>

      {/* Filters */}
      <Card className="p-4">
        <div className="space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-2 block">Brand</label>
              <Select value={brandFilter} onValueChange={setBrandFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Brands</SelectItem>
                  {brands?.map((brand) => (
                    <SelectItem key={brand.id} value={brand.prefix || brand.name}>
                      {brand.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-2 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="idle">Idle</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center space-x-2">
              <Switch
                id="expensive-filter"
                checked={onlyExpensive}
                onCheckedChange={setOnlyExpensive}
              />
              <Label htmlFor="expensive-filter">Only where we are more expensive</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="in-stock-filter"
                checked={onlyInStock}
                onCheckedChange={setOnlyInStock}
              />
              <Label htmlFor="in-stock-filter">Only in stock</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="hide-excluded-filter"
                checked={hideExcluded}
                onCheckedChange={setHideExcluded}
              />
              <Label htmlFor="hide-excluded-filter">Hide excluded</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="fire-sale-filter"
                checked={fireSaleOnly}
                onCheckedChange={setFireSaleOnly}
              />
              <Label htmlFor="fire-sale-filter">Fire sale only</Label>
            </div>
          </div>
        </div>
      </Card>

      {/* Bulk Actions */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedProducts.size > 0 ? (
              <span>{selectedProducts.size} SKUs selected</span>
            ) : (
              <span>No SKUs selected</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleQueueSelected}
              disabled={selectedProducts.size === 0 || queueSelectedMutation.isPending}
            >
              {queueSelectedMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Queue Selected SKUs
            </Button>
            <Button
              size="sm"
              onClick={handleQueueAll}
              disabled={!products || products.length === 0 || queueSelectedMutation.isPending}
            >
              {queueSelectedMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Queue All Filtered ({products?.length || 0})
            </Button>
          </div>
        </div>
      </Card>

      {/* Results Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={products && products.length > 0 && selectedProducts.size === products.length}
                  onCheckedChange={handleSelectAll}
                />
              </TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Checked</TableHead>
              <TableHead>Plain Best</TableHead>
              <TableHead>Brand Best</TableHead>
              <TableHead>Our Best</TableHead>
              <TableHead>Gap vs Plain</TableHead>
              <TableHead>Gap vs Brand</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : products?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                  No products found
                </TableCell>
              </TableRow>
            ) : (
              products?.map((product) => {
                const getBrand = () => {
                  if (!brands) return "-";
                  const brand = brands.find((b) => {
                    if (!b.prefix) return false;
                    const separator = b.prefix_style === "slash" ? "/" : "-";
                    const pattern = `${b.prefix}${separator}`;
                    return product.sku.startsWith(pattern);
                  });
                  return brand?.name || "-";
                };

                const gapVsPlain =
                  product.ph_our_best_price && product.ph_plain_best_price
                    ? product.ph_our_best_price - product.ph_plain_best_price
                    : null;

                const gapVsBrand =
                  product.ph_our_best_price && product.ph_brand_best_price
                    ? product.ph_our_best_price - product.ph_brand_best_price
                    : null;

                return (
                  <TableRow key={product.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedProducts.has(product.id)}
                        onCheckedChange={(checked) =>
                          handleSelectProduct(product.id, checked as boolean)
                        }
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {product.sku}
                      {product.fire_sale && (
                        <Badge variant="destructive" className="ml-2 text-xs">
                          Fire Sale
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{product.name}</TableCell>
                    <TableCell>{getBrand()}</TableCell>
                    <TableCell>{product.current_stock || 0}</TableCell>
                    <TableCell>{getStatusBadge(product.ph_status)}</TableCell>
                    <TableCell className="text-sm">
                      {product.ph_last_checked_at
                        ? format(new Date(product.ph_last_checked_at), "MMM d, HH:mm")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {product.ph_plain_best_price ? (
                        <div className="text-sm font-semibold">
                          £{product.ph_plain_best_price.toFixed(2)}
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      {product.ph_brand_best_price ? (
                        <div className="text-sm font-semibold">
                          £{product.ph_brand_best_price.toFixed(2)}
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      {product.ph_our_best_price ? (
                        <div className="text-sm font-semibold">
                          £{product.ph_our_best_price.toFixed(2)}
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      {gapVsPlain !== null ? (
                        <div
                          className={`text-sm font-medium ${
                            gapVsPlain > 0 ? "text-destructive" : "text-green-600"
                          }`}
                        >
                          {gapVsPlain > 0 ? "+" : ""}£{gapVsPlain.toFixed(2)}
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      {gapVsBrand !== null ? (
                        <div
                          className={`text-sm font-medium ${
                            gapVsBrand > 0 ? "text-destructive" : "text-green-600"
                          }`}
                        >
                          {gapVsBrand > 0 ? "+" : ""}£{gapVsBrand.toFixed(2)}
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/product/${product.id}`)}
                          title="View product"
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => queueMutation.mutate(product.id)}
                          disabled={queueMutation.isPending}
                          title="Re-queue price check"
                        >
                          <Play className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => resetMutation.mutate(product.id)}
                          disabled={resetMutation.isPending}
                          title="Reset result"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
        </div>

        {/* Brand Automation Panel - shown when a single brand is selected */}
        {selectedBrand && brandFilter !== "all" && (
          <div className="lg:col-span-1">
            <BrandAutomationPanel
              brandId={selectedBrand.id}
              brandName={selectedBrand.name}
              currentFilteredCount={products?.length || 0}
            />
          </div>
        )}
      </div>
    </div>
  );
}
