import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Search, Download, Loader2, Package, Sparkles, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface PreviewResult {
  count: number;
  sample: Array<{ sku: string; name: string }>;
}

export function MintsoftProductPull() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedBrandId, setSelectedBrandId] = useState<string>("");
  const [customPrefix, setCustomPrefix] = useState<string>("");
  const [singleSku, setSingleSku] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  // Fetch brands with prefixes
  const { data: brands } = useQuery({
    queryKey: ["brands-with-prefix"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, prefix, prefix_style")
        .not("prefix", "is", null)
        .order("name");

      if (error) throw error;
      return data;
    },
  });

  // Compute the effective prefix
  const getEffectivePrefix = (): string => {
    if (customPrefix.trim()) {
      return customPrefix.trim();
    }
    if (selectedBrandId && brands) {
      const brand = brands.find((b) => b.id === selectedBrandId);
      if (brand?.prefix) {
        const separator = brand.prefix_style === "slash" ? "/" : "-";
        return `${brand.prefix}${separator}`;
      }
    }
    return "";
  };

  const effectivePrefix = getEffectivePrefix();

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: async (prefix: string) => {
      const { data, error } = await supabase.functions.invoke(
        "mintsoft-fetch-products",
        {
          body: { prefix, mode: "preview" },
        }
      );
      if (error) throw error;
      return data as PreviewResult;
    },
    onSuccess: (data) => {
      setPreview(data);
      if (data.count === 0) {
        toast({
          title: "No products found",
          description: `No products match the prefix "${effectivePrefix}"`,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Search failed",
        description: error.message || "Failed to search Mintsoft",
        variant: "destructive",
      });
    },
  });

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async (prefix: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke(
        "mintsoft-fetch-products",
        {
          body: { prefix, mode: "import", userId: user?.id },
        }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Import successful",
        description: data.message || `Imported ${data.imported} products`,
      });
      setPreview(null);
      setCustomPrefix("");
      setSelectedBrandId("");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["upload-history"] });
      queryClient.invalidateQueries({ queryKey: ["import-history"] });
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error.message || "Failed to import products",
        variant: "destructive",
      });
    },
  });

  // Discover new products mutation
  const discoverMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "mintsoft-discover-new-products",
        { body: {} }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast({
        title: "Discovery complete",
        description:
          data?.message ||
          `Scanned ${data?.scanned ?? 0} products, added ${data?.added ?? 0} new SKUs.`,
      });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["import-history"] });
    },
    onError: (error: any) => {
      toast({
        title: "Discovery failed",
        description: error.message || "Failed to discover new products",
        variant: "destructive",
      });
    },
  });

  // Single SKU fetch mutation
  const singleSkuMutation = useMutation({
    mutationFn: async (sku: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke(
        "mintsoft-fetch-single-sku",
        { body: { sku, userId: user?.id } }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.found) {
        toast({
          title: "SKU imported",
          description: data.message,
        });
        setSingleSku("");
        queryClient.invalidateQueries({ queryKey: ["products"] });
        queryClient.invalidateQueries({ queryKey: ["upload-history"] });
      } else {
        toast({
          title: "SKU not found",
          description: data?.message || "Mintsoft returned no match",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Fetch failed",
        description: error?.context?.error || error.message || "Failed to fetch SKU",
        variant: "destructive",
      });
    },
  });

  const handleSearch = () => {
    if (!effectivePrefix) {
      toast({
        title: "Prefix required",
        description: "Please select a brand or enter a custom prefix",
        variant: "destructive",
      });
      return;
    }
    setPreview(null);
    previewMutation.mutate(effectivePrefix);
  };

  const handleImport = () => {
    if (!effectivePrefix || !preview || preview.count === 0) return;
    importMutation.mutate(effectivePrefix);
  };

  const handleBrandChange = (value: string) => {
    setSelectedBrandId(value);
    setCustomPrefix("");
    setPreview(null);
  };

  const handleCustomPrefixChange = (value: string) => {
    setCustomPrefix(value);
    setSelectedBrandId("");
    setPreview(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          Pull Products from Mintsoft
        </CardTitle>
        <CardDescription>
          Query Mintsoft for products by SKU prefix and import them directly into the product cache.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Discover New Products */}
        <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Discover new Mintsoft products
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                Scans Mintsoft from the highest known Product ID forward and adds any new SKUs (matching brand prefixes) to the cache. Runs automatically every Sunday at 06:00 UTC.
              </p>
            </div>
            <Button
              onClick={() => discoverMutation.mutate()}
              disabled={discoverMutation.isPending}
              variant="outline"
            >
              {discoverMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Discovering...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Run discovery now
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Single SKU Fetch */}
        <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
          <div>
            <h4 className="font-medium flex items-center gap-2">
              <Target className="h-4 w-4" />
              Fetch a single SKU
            </h4>
            <p className="text-sm text-muted-foreground mt-1">
              Hit Mintsoft's Search endpoint directly — perfect for one-offs without scanning the full catalog. Imports immediately if found.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={singleSku}
              onChange={(e) => setSingleSku(e.target.value)}
              placeholder="e.g., FA1-076.682.005"
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter" && singleSku.trim() && !singleSkuMutation.isPending) {
                  singleSkuMutation.mutate(singleSku.trim());
                }
              }}
            />
            <Button
              onClick={() => singleSkuMutation.mutate(singleSku.trim())}
              disabled={!singleSku.trim() || singleSkuMutation.isPending}
            >
              {singleSkuMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Fetching...
                </>
              ) : (
                <>
                  <Target className="mr-2 h-4 w-4" />
                  Fetch SKU
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Brand Selection */}
        <div className="space-y-2">
          <Label>Select a brand</Label>
          <Select value={selectedBrandId} onValueChange={handleBrandChange}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a brand..." />
            </SelectTrigger>
            <SelectContent>
              {brands?.map((brand) => (
                <SelectItem key={brand.id} value={brand.id}>
                  {brand.name} ({brand.prefix}
                  {brand.prefix_style === "slash" ? "/" : "-"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground uppercase">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Custom Prefix */}
        <div className="space-y-2">
          <Label>Enter custom prefix</Label>
          <Input
            value={customPrefix}
            onChange={(e) => handleCustomPrefixChange(e.target.value)}
            placeholder="e.g., PER-"
          />
        </div>

        {/* Effective Prefix Display */}
        {effectivePrefix && (
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm">
              <span className="text-muted-foreground">Searching for SKUs starting with: </span>
              <Badge variant="secondary" className="ml-1 font-mono">
                {effectivePrefix}
              </Badge>
            </p>
          </div>
        )}

        {/* Search Button */}
        <Button
          onClick={handleSearch}
          disabled={!effectivePrefix || previewMutation.isPending}
          className="w-full"
          variant="outline"
        >
          {previewMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Searching Mintsoft...
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4" />
              Search Mintsoft
            </>
          )}
        </Button>

        {/* Preview Results */}
        {preview && preview.count > 0 && (
          <div className="space-y-4 p-4 border rounded-lg bg-card">
            <div className="flex items-center justify-between">
              <h4 className="font-medium flex items-center gap-2">
                <Package className="h-4 w-4" />
                Preview Results
              </h4>
              <Badge variant="default">{preview.count} products</Badge>
            </div>

            <div className="space-y-2">
              {preview.sample.map((product, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 text-sm p-2 bg-muted/50 rounded"
                >
                  <span className="font-mono text-xs">{product.sku}</span>
                  <span className="text-muted-foreground">-</span>
                  <span className="truncate">{product.name}</span>
                </div>
              ))}
              {preview.count > 5 && (
                <p className="text-sm text-muted-foreground text-center">
                  ... and {preview.count - 5} more
                </p>
              )}
            </div>

            <Button
              onClick={handleImport}
              disabled={importMutation.isPending}
              className="w-full"
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Import {preview.count} Products
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
