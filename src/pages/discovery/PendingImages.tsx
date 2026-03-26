import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle, Trash2, Loader2, Copy, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const PendingImages = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: pendingImages, isLoading } = useQuery({
    queryKey: ["pending-images"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_images" as any)
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async ({ imageId, sku, publicUrl, filePath }: { imageId: string; sku: string; publicUrl: string; filePath: string }) => {
      // Create a minimal product record
      const { data: product, error: productError } = await supabase
        .from("products_cache")
        .insert({
          sku,
          name: sku,
          discovery_source: "image_upload",
        })
        .select("id")
        .single();

      if (productError) throw productError;

      // Move the file in storage from pending/ to {sku}/ folder
      const ext = filePath.split(".").pop() || "png";
      const newFilePath = `${sku}/${sku}.${ext}`;

      const { error: moveError } = await supabase.storage
        .from("product-images")
        .move(filePath, newFilePath);

      // Get the new public URL
      let finalFilePath = newFilePath;
      let finalPublicUrl = publicUrl;
      if (!moveError) {
        const { data: urlData } = supabase.storage
          .from("product-images")
          .getPublicUrl(newFilePath);
        finalPublicUrl = urlData.publicUrl;
      } else {
        // If move fails (e.g. file already exists), keep original path
        finalFilePath = filePath;
      }

      // Create product_images record with the (possibly moved) path
      const { error: imgError } = await supabase.from("product_images").insert({
        product_id: product.id,
        file_path: finalFilePath,
        public_url: finalPublicUrl,
        display_order: 0,
        is_primary: true,
      });

      if (imgError) throw imgError;

      // Mark pending image as promoted
      const { error: updateError } = await supabase
        .from("pending_images" as any)
        .update({ status: "promoted", promoted_product_id: product.id, reviewed_at: new Date().toISOString() } as any)
        .eq("id", imageId);

      if (updateError) throw updateError;

      return product.id;
    },
    onSuccess: (productId) => {
      queryClient.invalidateQueries({ queryKey: ["pending-images"] });
      toast({
        title: "Product created",
        description: "Image linked and product queued for enrichment",
      });
    },
    onError: (err: any) => {
      toast({ title: "Error promoting image", description: err.message, variant: "destructive" });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (imageId: string) => {
      const { error } = await supabase
        .from("pending_images" as any)
        .update({ status: "dismissed", reviewed_at: new Date().toISOString() } as any)
        .eq("id", imageId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-images"] });
      toast({ title: "Image dismissed" });
    },
  });

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: "URL copied" });
  };

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="text-pd-accent hover:text-pd-accent-light mb-2" onClick={() => navigate("/discovery")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Discovery
        </Button>
        <h1 className="text-2xl font-bold text-white">Pending Images</h1>
        <p className="text-sm text-white/60">
          Images uploaded without a matching product. Promote to create a product record, or dismiss.
        </p>
      </div>
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && (!pendingImages || pendingImages.length === 0) && (
          <Card>
            <CardContent className="py-12 text-center">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No pending images to review</p>
            </CardContent>
          </Card>
        )}

        {pendingImages && pendingImages.length > 0 && (
          <>
            <Badge variant="secondary">{pendingImages.length} pending</Badge>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {pendingImages.map((img: any) => (
                <Card key={img.id} className="border-dashed">
                  <CardContent className="p-3 space-y-3">
                    <div className="aspect-square rounded overflow-hidden bg-muted">
                      <img
                        src={img.public_url}
                        alt={img.suggested_sku}
                        className="object-cover w-full h-full"
                      />
                    </div>
                    <div>
                      <p className="font-mono text-sm font-medium">{img.suggested_sku}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(img.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() =>
                          promoteMutation.mutate({
                            imageId: img.id,
                            sku: img.suggested_sku,
                            publicUrl: img.public_url,
                            filePath: img.file_path,
                          })
                        }
                        disabled={promoteMutation.isPending}
                      >
                        {promoteMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Promote
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => dismissMutation.mutate(img.id)}
                        disabled={dismissMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full"
                      onClick={() => copyUrl(img.public_url)}
                    >
                      <Copy className="h-3 w-3 mr-1" /> Copy URL
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
    </div>
  );
};

export default PendingImages;
