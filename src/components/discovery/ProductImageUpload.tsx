import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, Trash2, Copy, Star, Loader2, ImageIcon } from "lucide-react";
import { getProductImagePath } from "@/lib/imageUrl";

interface ProductImageUploadProps {
  productId: string;
  productSku: string;
}

export default function ProductImageUpload({ productId, productSku }: ProductImageUploadProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const { data: images, isLoading } = useQuery({
    queryKey: ["product-images", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_images")
        .select("*")
        .eq("product_id", productId)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const deleteImage = useMutation({
    mutationFn: async ({ id, filePath }: { id: string; filePath: string }) => {
      await supabase.storage.from("product-images").remove([filePath]);
      const { error } = await supabase.from("product_images").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-images", productId] });
      toast({ title: "Image deleted" });
    },
  });

  const setPrimary = useMutation({
    mutationFn: async (imageId: string) => {
      // Unset all primary flags for this product
      await supabase
        .from("product_images")
        .update({ is_primary: false })
        .eq("product_id", productId);
      // Set the selected one
      const { error } = await supabase
        .from("product_images")
        .update({ is_primary: true })
        .eq("id", imageId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product-images", productId] });
      toast({ title: "Primary image set" });
    },
  });

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      try {
        const currentCount = images?.length || 0;
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
          const imgIndex = currentCount + i;
          const fileName = imgIndex === 0 ? `${productSku}.${ext}` : `${productSku}-${imgIndex + 1}.${ext}`;
          const filePath = fileName;

          const { error: uploadError } = await supabase.storage
            .from("product-images")
            .upload(filePath, file, { upsert: true });
          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage
            .from("product-images")
            .getPublicUrl(filePath);

          const { error: dbError } = await supabase.from("product_images").insert({
            product_id: productId,
            file_path: filePath,
            public_url: urlData.publicUrl,
            display_order: currentCount + i,
            is_primary: currentCount === 0 && i === 0,
          });
          if (dbError) throw dbError;
        }
        queryClient.invalidateQueries({ queryKey: ["product-images", productId] });
        toast({ title: `${files.length} image(s) uploaded` });
      } catch (err: any) {
        toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      } finally {
        setUploading(false);
      }
    },
    [productId, images, queryClient, toast]
  );

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: "URL copied to clipboard" });
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      handleUpload(e.dataTransfer.files);
    },
    [handleUpload]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5" />
          Product Images
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload area */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"
          onClick={() => document.getElementById(`file-input-${productId}`)?.click()}
        >
          {uploading ? (
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          ) : (
            <>
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Drag & drop images here, or click to browse
              </p>
            </>
          )}
          <input
            id={`file-input-${productId}`}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>

        {/* Image gallery */}
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : images && images.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {images.map((img) => (
              <div
                key={img.id}
                className="relative group border rounded-lg overflow-hidden bg-muted"
              >
                <img
                  src={img.public_url}
                  alt={productSku}
                  className="w-full h-32 object-cover"
                />
                {img.is_primary && (
                  <Badge className="absolute top-1 left-1 text-xs" variant="default">
                    Primary
                  </Badge>
                )}
                {/* Actions overlay */}
                <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => copyUrl(img.public_url)}
                    title="Copy URL"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  {!img.is_primary && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setPrimary.mutate(img.id)}
                      title="Set as primary"
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => deleteImage.mutate({ id: img.id, filePath: img.file_path })}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {/* URL display */}
                <div className="p-1.5">
                  <button
                    onClick={() => copyUrl(img.public_url)}
                    className="text-xs text-muted-foreground truncate block w-full text-left hover:text-primary font-mono"
                    title={img.public_url}
                  >
                    {img.public_url.split("/").slice(-2).join("/")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-2">
            No images uploaded yet
          </p>
        )}
      </CardContent>
    </Card>
  );
}
