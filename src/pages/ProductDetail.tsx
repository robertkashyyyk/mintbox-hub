import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import ProductImageUpload from "@/components/discovery/ProductImageUpload";
import { MintsoftCategoriesEditor } from "@/components/MintsoftCategoriesEditor";

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: product, isLoading } = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      if (!id) return null;
      // UUID v4-ish detection — otherwise treat as SKU
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const query = supabase
        .from("products_cache")
        .select(`
          *,
          barcode_types (type_name),
          product_category_links (
            product_categories (name)
          )
        `);
      const { data, error } = isUuid
        ? await query.eq("id", id).maybeSingle()
        : await query.eq("sku", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

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

  const ignoreSeller = useMutation({
    mutationFn: async ({ seller, brandId }: { seller: string; brandId: string | null }) => {
      const { error } = await supabase.from("ignored_sellers").insert({
        seller_username: seller,
        brand_id: brandId,
        reason: "Ignored from product detail page",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Seller ignored successfully" });
    },
  });

  const ignoreListing = useMutation({
    mutationFn: async ({ itemId, sku }: { itemId: string; sku: string }) => {
      const { error } = await supabase.from("ignored_listings").insert({
        ebay_item_id: itemId,
        sku,
        reason: "Ignored from product detail page",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Listing ignored successfully" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!product) {
    return <div>Product not found</div>;
  }

  const getBrandFromSku = (sku: string) => {
    if (!brands) return null;
    const brand = brands.find((b) => {
      if (!b.prefix) return false;
      const separator = b.prefix_style === "slash" ? "/" : "-";
      const pattern = `${b.prefix}${separator}`;
      return sku.startsWith(pattern);
    });
    return brand;
  };

  const brand = getBrandFromSku(product.sku);

  const calculateGap = (ourPrice: number | null, compPrice: number | null) => {
    if (!ourPrice || !compPrice) return null;
    const gap = ourPrice - compPrice;
    return {
      amount: Math.abs(gap),
      isAbove: gap > 0,
    };
  };

  const parseEbayItemId = (rawItemId: string | null): string | null => {
    if (!rawItemId) return null;
    // Strip v1| prefix and |0 suffix to get actual eBay item number
    const match = rawItemId.match(/^v1\|(\d+)\|/);
    return match ? match[1] : rawItemId;
  };

  const PriceBlock = ({
    title,
    price,
    seller,
    itemId,
    showIgnore,
  }: {
    title: string;
    price: number | null;
    seller: string | null;
    itemId: string | null;
    showIgnore?: boolean;
  }) => {
    const gap = title === "Our Listings" ? null : calculateGap(product.ph_our_best_price, price);
    const cleanItemId = parseEbayItemId(itemId);

    return (
      <div className="space-y-3 p-4 rounded-lg border bg-card">
        <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">{title}</h4>
        {price ? (
          <>
            <div className="text-3xl font-bold">£{price.toFixed(2)}</div>
            {seller && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Seller:</span>
                  <a
                    href={`https://www.ebay.co.uk/usr/${seller}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline font-medium"
                  >
                    {seller}
                  </a>
                </div>
                {showIgnore && (
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-red-600 hover:bg-red-700 text-foreground font-bold"
                    onClick={() =>
                      ignoreSeller.mutate({
                        seller,
                        brandId: brand?.id || null,
                      })
                    }
                  >
                    Ignore seller
                  </Button>
                )}
              </div>
            )}
            {cleanItemId && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Item:</span>
                  <a
                    href={`https://www.ebay.co.uk/itm/${cleanItemId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline font-mono font-medium"
                  >
                    {cleanItemId}
                  </a>
                </div>
                {showIgnore && (
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-orange-600 hover:bg-orange-700 text-foreground font-bold"
                    onClick={() =>
                      ignoreListing.mutate({
                        itemId,
                        sku: product.sku,
                      })
                    }
                  >
                    Ignore listing
                  </Button>
                )}
              </div>
            )}
            {gap && (
              <div
                className={`text-sm font-medium px-3 py-1.5 rounded-md inline-block ${
                  gap.isAbove ? "bg-destructive/10 text-destructive" : "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
                }`}
              >
                We are £{gap.amount.toFixed(2)} {gap.isAbove ? "above" : "below"}
              </div>
            )}
          </>
        ) : (
          <div className="text-muted-foreground">No data</div>
        )}
      </div>
    );
  };

  const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-medium text-sm">{value}</span>
    </div>
  );

  const BoxQuantityEditor = ({ productId, initial, onSaved }: { productId: string; initial: number; onSaved: () => void }) => {
    const [val, setVal] = useState<number>(initial || 1);
    useEffect(() => { setVal(initial || 1); }, [initial]);
    const dirty = val !== (initial || 1);
    const save = async () => {
      const { error } = await supabase
        .from("products_cache" as any)
        .update({ box_quantity: Math.max(1, val) } as any)
        .eq("id", productId);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Box quantity updated" });
      onSaved();
    };
    return (
      <div className="flex justify-between items-center gap-2">
        <span className="text-muted-foreground text-sm" title="Minimum order multiple. Purchase suggestions round up to this.">
          Box Quantity
        </span>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={1}
            value={val}
            onChange={(e) => setVal(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className={`h-7 w-20 text-right tabular-nums ${dirty ? "border-pd-accent" : ""} ${val > 1 ? "font-semibold" : ""}`}
          />
          {dirty && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={save} aria-label="Save">
              <Save className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" className="text-pd-accent hover:text-pd-accent/80" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">{product.name}</h1>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="font-mono text-lg text-pd-accent">{product.sku}</div>
          {brand && <Badge variant="secondary">{brand.name}</Badge>}
          {product.discontinued && <Badge variant="destructive">Discontinued</Badge>}
          {product.fire_sale && <Badge className="bg-orange-500 text-foreground">Fire Sale</Badge>}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Stock & Ordering</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <DetailRow label="Current Stock" value={product.current_stock || 0} />
            <DetailRow label="Back Orders" value={product.back_order_qty || 0} />
            <DetailRow label="On Order" value={product.on_order || 0} />
            <DetailRow label="Low Stock Alert" value={product.low_stock_alert_level || 0} />
            <DetailRow
              label="Cost Price"
              value={product.cost_price != null ? `£${Number(product.cost_price).toFixed(2)}` : "—"}
            />

            <BoxQuantityEditor
              productId={product.id}
              initial={(product as any).box_quantity ?? 1}
              onSaved={() => queryClient.invalidateQueries({ queryKey: ["product", id] })}
            />
            <DetailRow label="Last Synced" value={product.last_stock_sync ? format(new Date(product.last_stock_sync), "dd MMM yyyy, HH:mm") : "Never"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Identifiers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <DetailRow label="Barcode" value={product.barcode || "—"} />
            <DetailRow label="Barcode Type" value={(product as any).barcode_types?.type_name || "—"} />
            <DetailRow label="Mintsoft ID" value={product.mintsoft_product_id || "—"} />
            <DetailRow label="Suppliers" value={product.suppliers || "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Physical Attributes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <DetailRow label="Weight" value={product.weight ? `${product.weight}g` : "—"} />
            <DetailRow label="Height" value={product.height ? `${product.height}cm` : "—"} />
            <DetailRow label="Length" value={product.length ? `${product.length}cm` : "—"} />
            <DetailRow label="Depth" value={product.depth ? `${product.depth}cm` : "—"} />
            <DetailRow label="Handling Time" value={product.handling_time ? `${product.handling_time} day(s)` : "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Discovery & Categories</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <DetailRow label="Discovery Source" value={product.discovery_source || "—"} />
            <DetailRow label="Discovered At" value={product.discovered_at ? format(new Date(product.discovered_at), "dd MMM yyyy, HH:mm") : "—"} />
            <DetailRow label="Created" value={product.created_at ? format(new Date(product.created_at), "dd MMM yyyy") : "—"} />
            <MintsoftCategoriesEditor
              productId={product.id}
              categories={(product as any).mintsoft_categories}
            />
          </CardContent>
        </Card>

        <Card className="md:col-span-2 lg:col-span-2">
          <CardHeader>
            <CardTitle>Price Hunter</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Status</div>
                <Badge variant={product.ph_status === "done" ? "default" : "secondary"}>
                  {product.ph_status || "idle"}
                </Badge>
              </div>
              {product.ph_last_checked_at && (
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Last Checked</div>
                  <div className="text-sm">
                    {format(new Date(product.ph_last_checked_at), "MMM d, HH:mm")}
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <PriceBlock
                title="Plain Search"
                price={product.ph_plain_best_price}
                seller={product.ph_plain_best_seller}
                itemId={product.ph_plain_best_item_id}
                showIgnore
              />
              <PriceBlock
                title="Brand Search"
                price={product.ph_brand_best_price}
                seller={product.ph_brand_best_seller}
                itemId={product.ph_brand_best_item_id}
                showIgnore
              />
              <PriceBlock
                title="Our Listings"
                price={product.ph_our_best_price}
                seller={product.ph_our_best_seller}
                itemId={product.ph_our_best_item_id}
              />
            </div>

            {product.ph_error_message && (
              <div className="text-sm text-destructive">{product.ph_error_message}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Product Images */}
      <ProductImageUpload productId={product.id} productSku={product.sku} />
    </div>
  );
}
