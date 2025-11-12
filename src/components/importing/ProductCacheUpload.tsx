import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export function ProductCacheUpload() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: async (csvFile: File) => {
      setIsProcessing(true);
      setUploadProgress(10);

      // Read file content
      const text = await csvFile.text();
      setUploadProgress(30);

      // Call edge function to process CSV
      const { data, error } = await supabase.functions.invoke("process-product-csv", {
        body: { csvContent: text },
      });

      setUploadProgress(90);

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setUploadProgress(100);
      queryClient.invalidateQueries({ queryKey: ["products-cache"] });
      toast({
        title: "Products imported",
        description: `Successfully imported ${data.imported} products, ${data.updated} updated.`,
      });
      setFile(null);
      setUploadProgress(0);
      setIsProcessing(false);
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error.message || "Failed to import products from CSV.",
        variant: "destructive",
      });
      setUploadProgress(0);
      setIsProcessing(false);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith(".csv")) {
        toast({
          title: "Invalid file type",
          description: "Please select a CSV file.",
          variant: "destructive",
        });
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleUpload = () => {
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Product CSV</CardTitle>
        <CardDescription>
          Upload a Mintsoft product export CSV to populate the local product cache.
          The system will automatically detect barcode types and process categories.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label
              htmlFor="csv-upload"
              className="flex items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <div className="text-center">
                {file ? (
                  <div className="flex items-center gap-2">
                    <FileText className="h-6 w-6 text-primary" />
                    <span className="text-sm font-medium">{file.name}</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Click to select CSV file or drag and drop
                    </p>
                  </div>
                )}
              </div>
              <input
                id="csv-upload"
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
                disabled={isProcessing}
              />
            </label>
          </div>
        </div>

        {isProcessing && (
          <div className="space-y-2">
            <Progress value={uploadProgress} />
            <p className="text-sm text-muted-foreground text-center">
              Processing products... {uploadProgress}%
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleUpload}
            disabled={!file || isProcessing}
            className="flex-1"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload & Process
              </>
            )}
          </Button>
          {file && !isProcessing && (
            <Button
              variant="outline"
              onClick={() => setFile(null)}
            >
              Clear
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
