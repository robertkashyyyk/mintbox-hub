import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload, CheckCircle, XCircle, Copy, Loader2, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface FileMatch {
  file: File;
  sku: string;
  productId: string | null;
  productName: string | null;
  status: "matched" | "unmatched" | "uploading" | "uploaded" | "error";
  publicUrl?: string;
  error?: string;
}

const BulkImageUpload = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [isMatching, setIsMatching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const extractSku = (filename: string): string => {
    return filename.replace(/\.[^/.]+$/, "");
  };

  const matchFiles = useCallback(async (selectedFiles: File[]) => {
    setIsMatching(true);
    const skus = selectedFiles.map((f) => extractSku(f.name));
    const uniqueSkus = [...new Set(skus)];

    // Query products in batches
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
      return {
        file,
        sku,
        productId: product?.id || null,
        productName: product?.name || null,
        status: product ? "matched" : "unmatched",
      };
    });

    setFiles(matched);
    setIsMatching(false);

    const matchedCount = matched.filter((f) => f.status === "matched").length;
    toast({
      title: `${matchedCount} of ${matched.length} matched`,
      description: matchedCount < matched.length
        ? `${matched.length - matchedCount} file(s) had no matching SKU`
        : "All files matched to products",
    });
  }, [toast]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (droppedFiles.length) matchFiles(droppedFiles);
    },
    [matchFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files || []);
      if (selected.length) matchFiles(selected);
    },
    [matchFiles]
  );

  const uploadAll = async () => {
    const toUpload = files.filter((f) => f.status === "matched");
    if (!toUpload.length) return;

    setIsUploading(true);
    setUploadProgress(0);
    let completed = 0;

    const updated = [...files];

    for (const item of toUpload) {
      const idx = updated.findIndex((f) => f.file === item.file);
      updated[idx] = { ...updated[idx], status: "uploading" };
      setFiles([...updated]);

      const ext = item.file.name.split(".").pop();
      const filePath = `${item.productId}/${Date.now()}-${item.sku}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(filePath, item.file, { upsert: false });

      if (uploadError) {
        updated[idx] = { ...updated[idx], status: "error", error: uploadError.message };
        setFiles([...updated]);
        completed++;
        setUploadProgress(Math.round((completed / toUpload.length) * 100));
        continue;
      }

      const { data: urlData } = supabase.storage
        .from("product-images")
        .getPublicUrl(filePath);

      const { error: dbError } = await supabase.from("product_images").insert({
        product_id: item.productId!,
        file_path: filePath,
        public_url: urlData.publicUrl,
        display_order: 0,
        is_primary: false,
      });

      if (dbError) {
        updated[idx] = { ...updated[idx], status: "error", error: dbError.message };
      } else {
        updated[idx] = { ...updated[idx], status: "uploaded", publicUrl: urlData.publicUrl };
      }

      setFiles([...updated]);
      completed++;
      setUploadProgress(Math.round((completed / toUpload.length) * 100));
    }

    setIsUploading(false);
    const successCount = updated.filter((f) => f.status === "uploaded").length;
    toast({
      title: "Bulk upload complete",
      description: `${successCount} image(s) uploaded successfully`,
    });
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast({ title: "URL copied" });
  };

  const matchedCount = files.filter((f) => f.status === "matched").length;
  const uploadedCount = files.filter((f) => f.status === "uploaded").length;
  const errorCount = files.filter((f) => f.status === "error").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/discovery")} className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Discovery
          </Button>
          <h1 className="text-2xl font-bold">Bulk Image Upload</h1>
          <p className="text-sm text-muted-foreground">
            Drop image files named by SKU to automatically match and upload to products.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Drop zone */}
        <Card>
          <CardContent className="p-8">
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
                isDragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
              }`}
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
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {files.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex gap-3">
                <Badge variant="secondary">{files.length} files</Badge>
                <Badge className="bg-green-600">{matchedCount + uploadedCount} matched</Badge>
                {errorCount > 0 && <Badge variant="destructive">{errorCount} errors</Badge>}
              </div>
              <Button onClick={uploadAll} disabled={isUploading || matchedCount === 0}>
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Uploading…
                  </>
                ) : (
                  `Upload ${matchedCount} Matched`
                )}
              </Button>
            </div>

            {isUploading && <Progress value={uploadProgress} />}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {files.map((item, i) => (
                <Card key={i} className={item.status === "unmatched" ? "opacity-60" : ""}>
                  <CardContent className="p-3 space-y-2">
                    <div className="aspect-square rounded overflow-hidden bg-muted flex items-center justify-center">
                      <img
                        src={URL.createObjectURL(item.file)}
                        alt={item.sku}
                        className="object-cover w-full h-full"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      {item.status === "matched" && <ImageIcon className="h-4 w-4 text-blue-500" />}
                      {item.status === "uploaded" && <CheckCircle className="h-4 w-4 text-green-500" />}
                      {item.status === "unmatched" && <XCircle className="h-4 w-4 text-destructive" />}
                      {item.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin" />}
                      {item.status === "error" && <XCircle className="h-4 w-4 text-destructive" />}
                      <span className="font-mono text-sm truncate">{item.sku}</span>
                    </div>
                    {item.productName && (
                      <p className="text-xs text-muted-foreground truncate">{item.productName}</p>
                    )}
                    {item.status === "unmatched" && (
                      <p className="text-xs text-destructive">No product found for this SKU</p>
                    )}
                    {item.status === "error" && (
                      <p className="text-xs text-destructive">{item.error}</p>
                    )}
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
      </main>
    </div>
  );
};

export default BulkImageUpload;
