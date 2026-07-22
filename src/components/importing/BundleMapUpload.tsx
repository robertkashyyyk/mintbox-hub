import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, CheckCircle2, AlertCircle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = {
  components: number;
  bundles: number;
  distinct_components: number;
  components_with_cost: number;
  components_missing_cost: number;
  bundles_fully_costed: number;
  last_updated: string | null;
};

export function BundleMapUpload() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; bundles?: number; components?: number; skipped?: number; error?: string } | null>(null);

  const { data: status, refetch } = useQuery({
    queryKey: ["bundle-map-status"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("bundle_map_status");
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as Status;
    },
  });

  const pickFile = (f?: File | null) => {
    if (f && f.name.toLowerCase().endsWith(".csv")) {
      setFile(f);
      setResult(null);
    } else {
      toast({ title: "Invalid file", description: "Please select a CSV file", variant: "destructive" });
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      const { data, error } = await supabase.functions.invoke("ingest-bundle-map", { body: { csv: text } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data);
      toast({
        title: "Bundle map updated",
        description: `${data.bundles?.toLocaleString()} bundles / ${data.components?.toLocaleString()} components loaded`,
      });
      setFile(null);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["bundle-map-status"] });
    } catch (e: any) {
      setResult({ error: e.message || "Upload failed" });
      toast({ title: "Upload failed", description: e.message || "Failed to process CSV", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const costedPct = status && status.distinct_components > 0
    ? Math.round((status.components_with_cost / status.distinct_components) * 100)
    : 0;
  const staleDays = status?.last_updated
    ? Math.floor((Date.now() - new Date(status.last_updated).getTime()) / 86400000)
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-pd-accent" />
          <div>
            <CardTitle>Bundle Map (BOM)</CardTitle>
            <CardDescription>
              Upload the Mintsoft <strong>Bundle Breakdown Export</strong> to refresh the parent→component map used for
              bundle/pack profitability. Bundles change rarely — a monthly upload is plenty. Each upload fully replaces the map.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Live status */}
        {status && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Bundles" value={status.bundles?.toLocaleString()} />
            <Stat label="Components" value={status.components?.toLocaleString()} />
            <Stat label="Components costed" value={`${costedPct}%`}
              sub={`${status.components_with_cost?.toLocaleString()} / ${status.distinct_components?.toLocaleString()}`} />
            <Stat label="Bundles fully costed" value={status.bundles_fully_costed?.toLocaleString()} />
          </div>
        )}
        {status?.last_updated && (
          <p className={cn("text-xs", staleDays !== null && staleDays > 45 ? "text-warning" : "text-muted-foreground")}>
            Last updated {new Date(status.last_updated).toLocaleDateString()}
            {staleDays !== null ? ` (${staleDays} day${staleDays === 1 ? "" : "s"} ago)` : ""}
            {status.components_missing_cost > 0 ? ` • ${status.components_missing_cost.toLocaleString()} components still need a cost` : ""}
          </p>
        )}

        <div
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
            file ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50",
          )}
          onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
          onDragOver={(e) => e.preventDefault()}
        >
          <input type="file" accept=".csv" className="hidden" id="bundle-csv" disabled={busy}
            onChange={(e) => pickFile(e.target.files?.[0])} />
          <label htmlFor="bundle-csv" className="cursor-pointer">
            <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-sm font-medium mb-2">{file ? file.name : "Click to upload or drag and drop"}</p>
            <p className="text-xs text-muted-foreground">
              Mintsoft Bundle Breakdown Export — columns: BundleSKU, ComponentSKU, ComponentQuantity
            </p>
          </label>
        </div>

        {result && (
          <div className="flex items-center gap-2 text-sm p-3 bg-muted/50 rounded-lg">
            {result.error ? (
              <><AlertCircle className="h-4 w-4 text-destructive" /> <span>Error: {result.error}</span></>
            ) : (
              <><CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>{result.bundles?.toLocaleString()} bundles / {result.components?.toLocaleString()} components loaded
                  {result.skipped ? ` (${result.skipped.toLocaleString()} rows skipped)` : ""}</span></>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleUpload} disabled={!file || busy} className="flex-1">
            {busy ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</>) : "Upload & Refresh Bundle Map"}
          </Button>
          {file && !busy && (
            <Button variant="outline" onClick={() => { setFile(null); setResult(null); }}>Clear</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value?: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold text-foreground">{value ?? "—"}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
