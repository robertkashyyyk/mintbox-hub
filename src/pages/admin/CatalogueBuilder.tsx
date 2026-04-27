import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Save, Trash2, Loader2, Search, GripVertical } from "lucide-react";
import { getProductImageUrl } from "@/lib/imageUrl";

type Catalogue = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  public_visible: boolean;
  cover_image_url: string | null;
  brand_id: string | null;
  category_id: string | null;
  theme: Record<string, unknown>;
};

type CatalogueItem = {
  id: string;
  catalogue_id: string;
  product_id: string;
  display_order: number;
  custom_title: string | null;
  custom_description: string | null;
  featured: boolean;
};

type Product = {
  id: string;
  sku: string;
  name: string;
  marketing_title: string | null;
  marketing_description: string | null;
  trade_price: number | null;
  rrp: number | null;
  current_stock: number | null;
  brand_id: string | null;
  key_features: string[] | null;
};

export default function CatalogueBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: catalogue, isLoading: loadingCat } = useQuery({
    queryKey: ["catalogue", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalogues")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Catalogue;
    },
    enabled: !!id,
  });

  const { data: items } = useQuery({
    queryKey: ["catalogue-items", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalogue_items")
        .select("*")
        .eq("catalogue_id", id!)
        .order("display_order");
      if (error) throw error;
      return data as CatalogueItem[];
    },
    enabled: !!id,
  });

  const itemProductIds = useMemo(() => items?.map((i) => i.product_id) ?? [], [items]);

  const { data: itemProducts } = useQuery({
    queryKey: ["catalogue-item-products", itemProductIds],
    queryFn: async () => {
      if (!itemProductIds.length) return [] as Product[];
      const { data, error } = await supabase
        .from("products_cache")
        .select(
          "id, sku, name, marketing_title, marketing_description, trade_price, rrp, current_stock, brand_id, key_features",
        )
        .in("id", itemProductIds);
      if (error) throw error;
      return data as Product[];
    },
    enabled: itemProductIds.length > 0,
  });

  const { data: searchResults } = useQuery({
    queryKey: ["catalogue-product-search", search, catalogue?.brand_id],
    queryFn: async () => {
      if (!search.trim() || search.trim().length < 2) return [] as Product[];
      let q = supabase
        .from("products_cache")
        .select(
          "id, sku, name, marketing_title, marketing_description, trade_price, rrp, current_stock, brand_id, key_features",
        )
        .or(`sku.ilike.%${search}%,name.ilike.%${search}%`)
        .eq("quarantined", false)
        .limit(20);
      if (catalogue?.brand_id) q = q.eq("brand_id", catalogue.brand_id);
      const { data, error } = await q;
      if (error) throw error;
      return data as Product[];
    },
    enabled: !!search.trim() && search.trim().length >= 2,
  });

  const { data: brands } = useQuery({
    queryKey: ["brands-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const updateCatalogue = useMutation({
    mutationFn: async (patch: Partial<Catalogue>) => {
      const { error } = await supabase.from("catalogues").update(patch).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      queryClient.invalidateQueries({ queryKey: ["catalogue", id] });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const addItem = useMutation({
    mutationFn: async (productId: string) => {
      const nextOrder = (items?.length ?? 0) + 1;
      const { error } = await supabase.from("catalogue_items").insert({
        catalogue_id: id!,
        product_id: productId,
        display_order: nextOrder,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalogue-items", id] });
    },
    onError: (err: Error) =>
      toast({ title: "Could not add product", description: err.message, variant: "destructive" }),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from("catalogue_items").delete().eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["catalogue-items", id] }),
  });

  // Local edit state for catalogue meta
  const [draft, setDraft] = useState<Partial<Catalogue> | null>(null);
  const current = { ...catalogue, ...draft } as Catalogue | undefined;

  if (loadingCat || !catalogue) {
    return (
      <div className="flex items-center justify-center py-20 text-white/60">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const orderedItems = (items ?? []).slice().sort((a, b) => a.display_order - b.display_order);
  const productsById = new Map((itemProducts ?? []).map((p) => [p.id, p]));
  const itemIds = new Set(itemProductIds);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/catalogues")}>
            <ArrowLeft className="h-4 w-4" /> Library
          </Button>
          <div className="h-8 w-1 rounded-full bg-pd-accent" />
          <div>
            <h1 className="text-xl font-bold text-white">{current?.title}</h1>
            <p className="text-xs text-white/50 font-mono">{current?.slug}</p>
          </div>
          <Badge>{current?.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (draft) updateCatalogue.mutate(draft);
            }}
            disabled={!draft || updateCatalogue.isPending}
          >
            {updateCatalogue.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save changes
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: editor */}
        <div className="space-y-4">
          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="products">Products ({orderedItems.length})</TabsTrigger>
              <TabsTrigger value="publish">Publish</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-4 mt-4">
              <Card className="bg-card/60 border-white/10">
                <CardContent className="p-5 space-y-4">
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input
                      value={current?.title ?? ""}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      rows={3}
                      value={current?.description ?? ""}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cover image URL</Label>
                    <Input
                      value={current?.cover_image_url ?? ""}
                      onChange={(e) => setDraft({ ...draft, cover_image_url: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Filter to brand</Label>
                    <Select
                      value={current?.brand_id ?? "__none__"}
                      onValueChange={(v) =>
                        setDraft({ ...draft, brand_id: v === "__none__" ? null : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All brands" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">All brands</SelectItem>
                        {brands?.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="products" className="space-y-4 mt-4">
              <Card className="bg-card/60 border-white/10">
                <CardContent className="p-5 space-y-3">
                  <Label>Add products</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      className="pl-9"
                      placeholder="Search by SKU or name…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {search.trim().length >= 2 && (
                    <div className="border border-white/10 rounded-md max-h-64 overflow-auto divide-y divide-white/5">
                      {searchResults?.length === 0 && (
                        <div className="p-3 text-sm text-white/50">No matches.</div>
                      )}
                      {searchResults?.map((p) => {
                        const already = itemIds.has(p.id);
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between gap-3 p-2"
                          >
                            <div className="min-w-0">
                              <div className="text-sm text-white truncate">{p.name}</div>
                              <div className="text-xs text-white/50 font-mono">{p.sku}</div>
                            </div>
                            <Button
                              size="sm"
                              variant={already ? "ghost" : "default"}
                              disabled={already || addItem.isPending}
                              onClick={() => addItem.mutate(p.id)}
                            >
                              {already ? "Added" : <><Plus className="h-3.5 w-3.5" /> Add</>}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-card/60 border-white/10">
                <CardContent className="p-5">
                  <div className="text-sm text-white/70 mb-3">
                    {orderedItems.length} item{orderedItems.length === 1 ? "" : "s"}
                  </div>
                  {orderedItems.length === 0 ? (
                    <p className="text-sm text-white/50 py-6 text-center">
                      No products yet. Search above to add some.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {orderedItems.map((item, idx) => {
                        const p = productsById.get(item.product_id);
                        return (
                          <li
                            key={item.id}
                            className="flex items-center gap-3 p-2 rounded-md border border-white/5 bg-background/40"
                          >
                            <GripVertical className="h-4 w-4 text-white/30" />
                            <span className="text-xs text-white/40 w-6">{idx + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-white truncate">
                                {p?.marketing_title || p?.name || "Loading…"}
                              </div>
                              <div className="text-xs text-white/50 font-mono">{p?.sku}</div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => removeItem.mutate(item.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="publish" className="space-y-4 mt-4">
              <Card className="bg-card/60 border-white/10">
                <CardContent className="p-5 space-y-4">
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={current?.status}
                      onValueChange={(v: Catalogue["status"]) =>
                        setDraft({ ...draft, status: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="published">Published</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-white/10 p-3">
                    <div>
                      <Label>Public visibility</Label>
                      <p className="text-xs text-white/50">
                        When on, published catalogues are visible to unauthenticated visitors.
                        Phase 2 will expose the public page.
                      </p>
                    </div>
                    <Switch
                      checked={!!current?.public_visible}
                      onCheckedChange={(v) => setDraft({ ...draft, public_visible: v })}
                    />
                  </div>
                  <p className="text-xs text-white/40">
                    PDF generation arrives in Phase 3. For now, this is the live HTML preview.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right column: live preview */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider">
              Live preview
            </h2>
          </div>
          <div className="rounded-lg overflow-hidden border border-white/10 bg-[#0b0f17] max-h-[80vh] overflow-y-auto">
            <CataloguePreview
              catalogue={current!}
              items={orderedItems}
              productsById={productsById}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function CataloguePreview({
  catalogue,
  items,
  productsById,
}: {
  catalogue: Catalogue;
  items: CatalogueItem[];
  productsById: Map<string, Product>;
}) {
  return (
    <div className="text-white">
      {/* Cover */}
      <div
        className="relative px-8 py-16 border-b border-white/10"
        style={{
          backgroundImage: catalogue.cover_image_url
            ? `linear-gradient(180deg, rgba(11,15,23,0.55), rgba(11,15,23,0.95)), url(${catalogue.cover_image_url})`
            : "linear-gradient(135deg, #0b0f17 0%, #142033 100%)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="text-xs uppercase tracking-[0.3em] text-pd-accent mb-3">
          PartsDoc · Catalogue
        </div>
        <h1 className="text-4xl font-bold tracking-tight">{catalogue.title || "Untitled"}</h1>
        {catalogue.description && (
          <p className="mt-3 text-white/70 max-w-xl">{catalogue.description}</p>
        )}
        <div className="mt-6 text-xs text-white/40">
          {items.length} product{items.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Items */}
      <div className="divide-y divide-white/5">
        {items.length === 0 && (
          <div className="p-8 text-sm text-white/50">
            Add products from the panel on the left to see them appear here.
          </div>
        )}
        {items.map((item, idx) => {
          const p = productsById.get(item.product_id);
          if (!p) return null;
          const title = item.custom_title || p.marketing_title || p.name;
          const desc = item.custom_description || p.marketing_description;
          const imgUrl = getProductImageUrl(p.sku);
          return (
            <div key={item.id} className="grid grid-cols-[120px_1fr_auto] gap-5 p-5 items-start">
              <div className="aspect-square rounded-md bg-white/5 overflow-hidden flex items-center justify-center">
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt={p.name}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <span className="text-white/30 text-xs">No image</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-white/40 font-mono mb-1">
                  #{idx + 1} · {p.sku}
                </div>
                <h3 className="text-lg font-semibold leading-tight">{title}</h3>
                {desc && <p className="mt-2 text-sm text-white/70 line-clamp-3">{desc}</p>}
                {p.key_features && p.key_features.length > 0 && (
                  <ul className="mt-2 text-xs text-white/60 list-disc pl-4 space-y-0.5">
                    {p.key_features.slice(0, 3).map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="text-right">
                {p.trade_price != null && (
                  <div className="text-xs text-white/50">Trade</div>
                )}
                {p.trade_price != null && (
                  <div className="text-lg font-bold text-pd-accent">
                    £{Number(p.trade_price).toFixed(2)}
                  </div>
                )}
                {p.rrp != null && (
                  <div className="text-xs text-white/50 mt-1">
                    RRP £{Number(p.rrp).toFixed(2)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
