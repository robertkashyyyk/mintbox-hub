import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Loader2, Download } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast as sonnerToast } from "sonner";

export function ProductCacheUpload() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: async ({ file, name }: { file: File; name: string }) => {
      setIsProcessing(true);
      setUploadProgress(30);

      const csvContent = await file.text();
      setUploadProgress(50);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const { data, error } = await supabase.functions.invoke(
        "process-product-csv",
        {
          body: { csvContent, uploadName: name, userId: user.id },
        }
      );

      setUploadProgress(100);

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Upload successful",
        description: `Imported ${data.imported} products across ${data.categories} categories`,
      });
      setFile(null);
      setUploadName("");
      setUploadProgress(0);
      setIsProcessing(false);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["upload-history"] });
    },
    onError: (error: any) => {
      toast({
        title: "Upload failed",
        description: error.message || "Failed to process CSV",
        variant: "destructive",
      });
      setUploadProgress(0);
      setIsProcessing(false);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.name.endsWith(".csv")) {
      setFile(selectedFile);
    } else {
      toast({
        title: "Invalid file",
        description: "Please select a CSV file",
        variant: "destructive",
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith(".csv")) {
      setFile(droppedFile);
    }
  };

  const handleUpload = () => {
    if (file && uploadName.trim()) {
      uploadMutation.mutate({ file, name: uploadName.trim() });
    }
  };

  const downloadTemplate = () => {
    const headers = [
      "SKU",
      "Name",
      "EANBarcode",
      "UPCBarcode",
      "MintsoftProductID",
      "Discontinued",
      "Suppliers",
      "LowStockAlertLevel",
      "Weight",
      "Height",
      "Length",
      "Depth",
      "CostPrice",
      "HandlingTime",
      "CurrentStock",
      "BackOrderQty",
      "OnOrder",
      "Categories",
    ];

    const exampleRow = [
      "NGK-02412",
      "NGK Spark Plug BKR6E",
      "087295024126",
      "",
      "12345",
      "false",
      "NGK Distributors",
      "10",
      "0.05",
      "8",
      "2",
      "2",
      "2.50",
      "1",
      "50",
      "0",
      "20",
      "Spark Plugs, Automotive",
    ];

    const csvContent = [
      headers.join(","),
      exampleRow.join(","),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "product-upload-template.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    sonnerToast.success("Template downloaded successfully");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Upload Product CSV</CardTitle>
            <CardDescription>
              Upload a Mintsoft product export CSV to populate the local product cache.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-2" />
            Download Template
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="upload-name" className="text-sm font-medium">
            Upload Name
          </label>
          <input
            id="upload-name"
            type="text"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="e.g., Berryman Products Jan 2025"
            className="w-full px-3 py-2 border rounded-md"
            disabled={isProcessing}
          />
        </div>

        <div
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
            file
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          )}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <input
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
            id="csv-upload"
            disabled={isProcessing}
          />
          <label htmlFor="csv-upload" className="cursor-pointer">
            <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-sm font-medium mb-2">
              {file ? file.name : "Click to upload or drag and drop"}
            </p>
            <p className="text-xs text-muted-foreground">
              CSV files only • Download template above for correct format
            </p>
          </label>
        </div>

        {isProcessing && (
          <div className="space-y-2">
            <Progress value={uploadProgress} />
            <p className="text-sm text-muted-foreground text-center">
              Processing... {uploadProgress}%
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleUpload}
            disabled={!file || !uploadName.trim() || isProcessing}
            className="flex-1"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Upload & Process"
            )}
          </Button>
          {file && (
            <Button
              variant="outline"
              onClick={() => {
                setFile(null);
                setUploadName("");
                setUploadProgress(0);
              }}
              disabled={isProcessing}
            >
              Clear
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
