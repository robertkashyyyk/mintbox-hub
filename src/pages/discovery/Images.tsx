import { useState, useCallback, useRef } from "react";
import { Images as ImagesIcon, Upload, CheckCircle, XCircle, Copy, Loader2, ImageIcon, Clock, Wrench, Sparkles, Bot } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getProductImagePath, getProductImageUrl } from "@/lib/imageUrl";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileMatch {
  file: File;
  sku: string;
  productId: string | null;
  productName: string | null;
  status: "matched" | "unmatched" | "uploading" | "uploaded" | "queued" | "error";
  publicUrl?: string;
  error?: string;
}

// ─── Bulk Upload Tab ──────────────────────────────────────────────────────────

const BulkUploadTab = () => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [isMatching, setIsMatching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);

  const runBackfill = async () => {
    setIsBackfilling(true);
    try {
      const { data, error } = await supabase.functions.invoke("backfill-image-paths");
      if (error) throw error;
      toast({ title: "Backfill complete", description: `${data.moved} migrated, ${data.errors} errors` });
    } catch (e: any) {
      toast({ title: "Backfill failed", description: e.message, variant: "destructive" });
    } finally {
      setIsBackfilling(false);
    }
  };

  const extractSku = (filename: string) => filename.replace(/\.[^/.]+$/, "");

  const matchFiles = useCallback(async (selectedFiles: File[]) => {
    setIsMatching(true);
    const skus = selectedFiles.map((f) => extractSku(f.name));
    const uniqueSkus = [...new Set(skus)];

    const { data: products, error } = await supabase
      .from("products_cache")
      .select("id, sku, name")
      .in("sku", uniqueSkus);

    if (error) {
      toast({ title: "Error looking up SKUs", description: error.message, variant: "destructive" });
      setIsMatching(false);
      return;
    }

    const skuMap = new Map(products?.map((p) => [p.sku, { id: p.id, name: p.name }]) || []);
    const matched: FileMatch[] = selectedFiles.map((file) => {
      const sku = extractSku(file.name);
      const product = skuMap.get(sku);
      return { file, sku, productId: product?.id || null, productName: product?.name || null, status: product ? "matched" : "unmatched" };
    });

    setFiles(matched);
    setIsMatching(false);
    const matchedCount = matched.filter((f) => f.status === "matched").length;
    toast({
      title: `${matchedCount} of ${matched.length} matched`,
      description: matchedCount < matched.length
        ? `${matched.length - matchedCount} file(s) had no matching SKU — they'll be queued for review`
        : "All files matched to products",
    });
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (droppedFiles.length) matchFiles(droppedFiles);
  }, [matchFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length) matchFiles(selected);
  }, [matchFiles]);

  const uploadAll = async () => {
    const toProcess = files.filter((f) => f.status === "matched" || f.status === "unmatched");
    if (!toProcess.length) return;

    setIsUploading(true);
    setUploadProgress(0);
    let completed = 0;
    const updated = [...files];

    for (const item of toProcess) {
      const idx = updated.findIndex((f) => f.file === item.file);
      updated[idx] = { ...updated[idx], status: "uploading" };
      setFiles([...updated]);

      const ext = item.file.name.split(".").pop() || "png";
      const isMatched = item.productId !== null;
      const filePath = isMatched ? getProductImagePath(item.sku, ext) : `pending/${item.sku}.${ext}`;

      const { error: uploadError } = await supabase.storage.from("product-images").upload(filePath, item.file, { upsert: true });

      if (uploadError) {
        updated[idx] = { ...updated[idx], status: "error", error: uploadError.message };
        setFiles([...updated]);
        completed++;
        setUploadProgress(Math.round((completed / toProcess.length) * 100));
        continue;
      }

      const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(filePath);

      if (isMatched) {
        const { error: dbError } = await supabase.from("product_images").insert({
          product_id: item.productId!,
          file_path: filePath,
          public_url: urlData.publicUrl,
          display_order: 0,
          is_primary: false,
        });
        updated[idx] = { ...updated[idx], status: dbError ? "error" : "uploaded", error: dbError?.message, publicUrl: urlData.publicUrl };
      } else {
        const { error: dbError } = await supabase.from("pending_images" as any).insert({
          suggested_sku: item.sku,
          file_path: filePath,
          public_url: urlData.publicUrl,
          status: "pending",
        });
        updated[idx] = { ...updated[idx], status: dbError ? "error" : "queued", error: dbError?.message, publicUrl: urlData.publicUrl };
      }

      setFiles([...updated]);
      completed++;
      setUploadProgress(Math.round((completed / toProcess.length) * 100));
    }

    setIsUploading(false);
    const successCount = updated.filter((f) => f.status === "uploaded").length;
    const queuedCount = updated.filter((f) => f.status === "queued").length;
    toast({ title: "Bulk upload complete", description: `${successCount} uploaded to products, ${queuedCount} queued for review` });
  };

  const copyUrl = (url: string) => { navigator.clipboard.writeText(url); toast({ title: "URL copied" }); };

  const matchedCount = files.filter((f) => f.status === "matched").length;
  const unmatchedCount = files.filter((f) => f.status === "unmatched").length;
  const uploadedCount = files.filter((f) => f.status === "uploaded").length;
  const queuedCount = files.filter((f) => f.status === "queued").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const readyCount = matchedCount + unmatchedCount;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-8">
          <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${isDragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {isMatching ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <p className="text-muted-foreground">Matching files to SKUs…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">Drop images here or click to select</p>
                <p className="text-sm text-muted-foreground">
                  Name files by SKU (e.g. <code className="bg-muted px-1 rounded">ABC-123.jpg</code>)
                </p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" onClick={runBackfill} disabled={isBackfilling}>
          {isBackfilling ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Running…</> : <><Wrench className="h-4 w-4 mr-2" />Clean Up Image URLs</>}
        </Button>
      </div>

      {files.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-3 flex-wrap">
              <Badge variant="secondary">{files.length} files</Badge>
              {(matchedCount + uploadedCount) > 0 && <Badge className="bg-primary text-primary-foreground">{matchedCount + uploadedCount} matched</Badge>}
              {(unmatchedCount + queuedCount) > 0 && <Badge variant="outline">{unmatchedCount + queuedCount} unmatched → review queue</Badge>}
              {errorCount > 0 && <Badge variant="destructive">{errorCount} errors</Badge>}
            </div>
            <Button onClick={uploadAll} disabled={isUploading || readyCount === 0}>
              {isUploading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processing…</> : `Upload All ${readyCount}`}
            </Button>
          </div>

          {isUploading && <Progress value={uploadProgress} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {files.map((item, i) => (
              <Card key={i} className={item.status === "unmatched" ? "border-dashed" : ""}>
                <CardContent className="p-3 space-y-2">
                  <div className="aspect-square rounded overflow-hidden bg-muted flex items-center justify-center">
                    <img src={URL.createObjectURL(item.file)} alt={item.sku} className="object-cover w-full h-full" />
                  </div>
                  <div className="flex items-center gap-2">
                    {item.status === "matched" && <ImageIcon className="h-4 w-4 text-primary" />}
                    {item.status === "uploaded" && <CheckCircle className="h-4 w-4 text-primary" />}
                    {item.status === "unmatched" && <Clock className="h-4 w-4 text-muted-foreground" />}
                    {item.status === "queued" && <Clock className="h-4 w-4 text-primary" />}
                    {item.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin" />}
                    {item.status === "error" && <XCircle className="h-4 w-4 text-destructive" />}
                    <span className="font-mono text-sm truncate">{item.sku}</span>
                  </div>
                  {item.productName && <p className="text-xs text-muted-foreground truncate">{item.productName}</p>}
                  {item.status === "unmatched" && <p className="text-xs text-muted-foreground">Will be queued for review</p>}
                  {item.status === "queued" && <p className="text-xs text-muted-foreground">Queued — see Pending Review tab</p>}
                  {item.status === "error" && <p className="text-xs text-destructive">{item.error}</p>}
                  {item.publicUrl && (
                    <Button size="sm" variant="outline" className="w-full" onClick={() => copyUrl(item.publicUrl!)}>
                      <Copy className="h-3 w-3 mr-1" /> Copy URL
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Pending Review Tab ───────────────────────────────────────────────────────

const PendingReviewTab = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: pendingImages, isLoading } = useQuery({
    queryKey: ["pending-images"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pending_images" as any).select("*").eq("status", "pending").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async ({ imageId, sku, publicUrl, filePath }: { imageId: string; sku: string; publicUrl: string; filePath: string }) => {
      const { data: product, error: productError } = await supabase.from("products_cache").insert({ sku, name: sku, discovery_source: "image_upload" }).select("id").single();
      if (productError) throw productError;

      const ext = filePath.split(".").pop() || "png";
      const newFilePath = `${sku}.${ext}`;
      const { error: moveError } = await supabase.storage.from("product-images").move(filePath, newFilePath);

      let finalFilePath = moveError ? filePath : newFilePath;
      let finalPublicUrl = publicUrl;
      if (!moveError) {
        const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(newFilePath);
        finalPublicUrl = urlData.publicUrl;
      }

      const { error: imgError } = await supabase.from("product_images").insert({ product_id: product.id, file_path: finalFilePath, public_url: finalPublicUrl, display_order: 0, is_primary: true });
      if (imgError) throw imgError;

      const { error: updateError } = await supabase.from("pending_images" as any).update({ status: "promoted", promoted_product_id: product.id, reviewed_at: new Date().toISOString() } as any).eq("id", imageId);
      if (updateError) throw updateError;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["pending-images"] }); toast({ title: "Product created", description: "Image linked and product queued for enrichment" }); },
    onError: (err: any) => toast({ title: "Error promoting image", description: err.message, variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: async (imageId: string) => {
      const { error } = await supabase.from("pending_images" as any).update({ status: "dismissed", reviewed_at: new Date().toISOString() } as any).eq("id", imageId);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["pending-images"] }); toast({ title: "Image dismissed" }); },
  });

  const copyUrl = (url: string) => { navigator.clipboard.writeText(url); toast({ title: "URL copied" }); };

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  if (!pendingImages || pendingImages.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <CheckCircle className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No pending images to review</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="secondary">{pendingImages.length} pending</Badge>
        <p className="text-sm text-muted-foreground">Images uploaded without a matching product. Promote to create a new product record, or dismiss.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {pendingImages.map((img: any) => (
          <Card key={img.id} className="border-dashed">
            <CardContent className="p-3 space-y-3">
              <div className="aspect-square rounded overflow-hidden bg-muted">
                <img src={img.public_url} alt={img.suggested_sku} className="object-cover w-full h-full" />
              </div>
              <div>
                <p className="font-mono text-sm font-medium">{img.suggested_sku}</p>
                <p className="text-xs text-muted-foreground">{new Date(img.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => promoteMutation.mutate({ imageId: img.id, sku: img.suggested_sku, publicUrl: img.public_url, filePath: img.file_path })} disabled={promoteMutation.isPending}>
                  {promoteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><CheckCircle className="h-3 w-3 mr-1" />Promote</>}
                </Button>
                <Button size="sm" variant="outline" onClick={() => dismissMutation.mutate(img.id)} disabled={dismissMutation.isPending}>
                  <XCircle className="h-3 w-3" />
                </Button>
              </div>
              <Button size="sm" variant="ghost" className="w-full" onClick={() => copyUrl(img.public_url)}>
                <Copy className="h-3 w-3 mr-1" /> Copy URL
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

// ─── AI Scout Tab (placeholder) ───────────────────────────────────────────────

const AiScoutTab = () => (
  <Card>
    <CardContent className="py-16 text-center space-y-4">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-pd-accent/10 mx-auto">
        <Bot className="h-8 w-8 text-pd-accent" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">AI Image Scout</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Automatically find and suggest product images from the web based on SKU, brand, and product name. Coming soon.
        </p>
      </div>
      <Badge variant="outline" className="text-pd-accent border-pd-accent/30">
        <Sparkles className="h-3 w-3 mr-1" />
        Planned
      </Badge>
    </CardContent>
  </Card>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

const ImagesPage = () => {
  const { data: pendingCount } = useQuery({
    queryKey: ["pending-images-count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("pending_images" as any).select("*", { count: "exact", head: true }).eq("status", "pending");
      if (error) return 0;
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Images"
        description="Upload product images in bulk, review unmatched uploads, and discover images automatically."
        icon={ImagesIcon}
      />

      <Tabs defaultValue="bulk-upload">
        <TabsList>
          <TabsTrigger value="bulk-upload">
            <Upload className="h-4 w-4 mr-2" />
            Bulk Upload
          </TabsTrigger>
          <TabsTrigger value="pending-review" className="relative">
            <Clock className="h-4 w-4 mr-2" />
            Pending Review
            {pendingCount != null && pendingCount > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1.5 text-xs">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ai-scout">
            <Bot className="h-4 w-4 mr-2" />
            AI Scout
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bulk-upload" className="mt-6">
          <BulkUploadTab />
        </TabsContent>
        <TabsContent value="pending-review" className="mt-6">
          <PendingReviewTab />
        </TabsContent>
        <TabsContent value="ai-scout" className="mt-6">
          <AiScoutTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ImagesPage;
