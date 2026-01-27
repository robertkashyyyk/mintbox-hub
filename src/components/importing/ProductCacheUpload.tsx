import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, Download, Info, ChevronDown, ChevronUp, CheckCircle2, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast as sonnerToast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useChunkedCsvUpload } from "@/hooks/useChunkedCsvUpload";

export function ProductCacheUpload() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  const { progress, processChunkedUpload, reset } = useChunkedCsvUpload();

  const isProcessing = progress.status === "parsing" || progress.status === "uploading";

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.name.endsWith(".csv")) {
      setFile(selectedFile);
      reset();
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
      reset();
    }
  };

  const handleUpload = async () => {
    if (!file || !uploadName.trim()) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const result = await processChunkedUpload(file, uploadName.trim(), user.id);

      toast({
        title: "Upload successful",
        description: `Imported ${result.imported.toLocaleString()} products${result.categories > 0 ? ` across ${result.categories} categories` : ""}`,
      });

      setFile(null);
      setUploadName("");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["upload-history"] });
      queryClient.invalidateQueries({ queryKey: ["products-needs-enrichment"] });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message || "Failed to process CSV",
        variant: "destructive",
      });
    }
  };

  const handleClear = () => {
    setFile(null);
    setUploadName("");
    reset();
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

  const progressPercent = progress.totalRows > 0
    ? Math.round((progress.processedRows / progress.totalRows) * 100)
    : 0;

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
        {/* Mintsoft Export Help */}
        <Collapsible open={showHelp} onOpenChange={setShowHelp}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between">
              <span className="flex items-center gap-2">
                <Info className="h-4 w-4" />
                Mintsoft Export Guide
              </span>
              {showHelp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <Alert>
              <AlertDescription className="space-y-3 text-sm">
                <p className="font-medium">Quick Catalog Import (Recommended for large exports)</p>
                <p>For a fast import of your entire product catalog, export a CSV from Mintsoft with just these columns:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><code className="bg-muted px-1 rounded">ProductID</code> (or ID) - Mintsoft's product ID</li>
                  <li><code className="bg-muted px-1 rounded">SKU</code> - Product SKU</li>
                  <li><code className="bg-muted px-1 rounded">Name</code> - Product name</li>
                </ul>
                <p className="text-muted-foreground">
                  Full product details (cost, stock, barcode) will be fetched automatically in the background every 2 hours.
                  Products appear in the <strong>Discovery Queue</strong> until enriched.
                </p>
                <p className="font-medium mt-3">Massive File Support</p>
                <p className="text-muted-foreground">
                  Files with 200k+ rows are automatically split into 5,000-row chunks and processed sequentially. 
                  You'll see real-time progress as each chunk completes.
                </p>
                <p className="font-medium mt-3">Full Import</p>
                <p>For a complete import with all details, include additional columns like CostPrice, CurrentStock, Categories, etc. Download the template for the full list.</p>
              </AlertDescription>
            </Alert>
          </CollapsibleContent>
        </Collapsible>

        <div className="space-y-2">
          <label htmlFor="upload-name" className="text-sm font-medium">
            Upload Name
          </label>
          <input
            id="upload-name"
            type="text"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="e.g., Mintsoft Full Catalog Jan 2025"
            className="w-full px-3 py-2 border rounded-md bg-background"
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
              CSV files only • Supports massive files (200k+ rows) with automatic chunking
            </p>
          </label>
        </div>

        {/* Progress Display */}
        {(isProcessing || progress.status === "complete" || progress.status === "error") && (
          <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                {progress.status === "parsing" && (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Parsing CSV file...
                  </>
                )}
                {progress.status === "uploading" && (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing chunk {progress.currentChunk} of {progress.totalChunks}
                  </>
                )}
                {progress.status === "complete" && (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Import complete
                  </>
                )}
                {progress.status === "error" && (
                  <>
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    Error: {progress.error}
                  </>
                )}
              </span>
              <span className="font-medium">
                {progress.importedCount.toLocaleString()} imported
              </span>
            </div>

            <Progress value={progressPercent} className="h-2" />

            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {progress.processedRows.toLocaleString()} / {progress.totalRows.toLocaleString()} rows
              </span>
              <span>{progressPercent}%</span>
            </div>
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
          {(file || progress.status !== "idle") && (
            <Button
              variant="outline"
              onClick={handleClear}
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
