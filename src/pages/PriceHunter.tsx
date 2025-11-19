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
import { useToast } from "@/hooks/use-toast";
import { Loader2, Play, RotateCcw, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";

export default function PriceHunter() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Fetch brands for filter
  const { data: brands } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, prefix")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch products with PH data
  const { data: products, isLoading } = useQuery({
    queryKey: ["price-hunter-products", brandFilter, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("products_cache")
        .select("*")
        .order("sku");

      if (brandFilter !== "all") {
        query = query.ilike("sku", `${brandFilter}%`);
      }

      if (statusFilter !== "all") {
        query = query.eq("ph_status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Queue for price check
  const queueMutation = useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase
        .from("products_cache")
        .update({
          ph_status: "queued",
          ph_error_message: null,
        })
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/menu/tools")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Tools
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Price Hunter – Queue & Results</h1>
            <p className="text-muted-foreground">
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
        <div className="flex gap-4">
          <div className="flex-1">
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
          <div className="flex-1">
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
      </Card>

      {/* Results Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Search Term</TableHead>
              <TableHead>PH Brand</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Checked</TableHead>
              <TableHead>Plain Best</TableHead>
              <TableHead>Brand Best</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : products?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No products found
                </TableCell>
              </TableRow>
            ) : (
              products?.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                  <TableCell>{product.ph_brand || "-"}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {product.ph_search_term || "-"}
                  </TableCell>
                  <TableCell>{product.ph_brand || "-"}</TableCell>
                  <TableCell>{getStatusBadge(product.ph_status)}</TableCell>
                  <TableCell className="text-sm">
                    {product.ph_last_checked_at
                      ? format(new Date(product.ph_last_checked_at), "MMM d, HH:mm")
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {product.ph_plain_best_price ? (
                      <div className="text-sm">
                        <div className="font-semibold">
                          £{product.ph_plain_best_price}
                        </div>
                        <div className="text-muted-foreground">
                          {product.ph_plain_best_seller}
                        </div>
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    {product.ph_brand_best_price ? (
                      <div className="text-sm">
                        <div className="font-semibold">
                          £{product.ph_brand_best_price}
                        </div>
                        <div className="text-muted-foreground">
                          {product.ph_brand_best_seller}
                        </div>
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
                        onClick={() => queueMutation.mutate(product.id)}
                        disabled={queueMutation.isPending}
                      >
                        <Play className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resetMutation.mutate(product.id)}
                        disabled={resetMutation.isPending}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
