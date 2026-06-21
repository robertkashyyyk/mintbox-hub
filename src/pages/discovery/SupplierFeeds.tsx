import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Copy, CheckCircle2, AlertTriangle, RefreshCw, Download } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// Mintsoft support inbox the reconciliation emails are addressed to.
const MINTSOFT_SUPPORT = "support@mintsoft.co.uk";

// Exact headers from Mintsoft's bulk-upload templates (column order matters).
const PRODUCT_UPLOAD_HEADER =
  "SKU,Name,EANBarcode,UPCBarcode,Description,Discontinued,BackOrderable,CommodityCode,CustomsDescription,CountryOfManufacture,MIDCode,Material,Categories,Suppliers,HasBatchNumber,LogBatchInbound,LogBatchOutbound,HasSerialNumber,LogSerialInbound,LogSerialOutbound,LowStockAlertLevel,Weight,Height,Length,Depth,Price,CostPrice,Volume,PalletSizes,FirstItemPickingCost,AdditionalItemPickingCost,FirstCartonPickingCost,AdditionalCartonPickingCost,FirstPalletPickingCost,AdditionalPalletPickingCost,StorageUnit,PackagingFee,AdditionalParcelsRequired,ImageURL,UnNumber,HandlingTime,HasExpiryDate,LogExpiryDateInbound,LogExpiryDateOutbound,FreePickingAsAdditional,PackingInstructions,InfiniteStock,BestBeforeDateWarningPeriodDays,UnitsPerParcel,NewSKU,OpeningStockLevel,Location,GoodsInCostSku,GoodsInCostUnit,TaxExempt,ToteCapacity,ReturnsCostFirstItem,ReturnsCostAdditionalItem";
const TRANSFER_HEADER =
  "Client,SKU,BatchNo,SerialNo,BestBefore,QTY,WarehouseTransferFrom,LocationTransferFrom,WarehouseTransferTo,LocationTransferTo";
const CLIENT_NAME = "PartsDoc Ltd";

function downloadCsv(filename: string, lines: string[]) {
  const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

type Feed = {
  supplier: string; display_name: string | null; enabled: boolean;
  warehouse_id: number; location_name: string; mapping_kind: string;
  last_run_at: string | null; last_run_summary: any;
};
type Run = {
  id: string; run_type: string; status: string;
  started_at: string; finished_at: string | null; summary: any;
};
type Anomaly = {
  id: string; created_at: string; supplier: string; sku: string;
  anomaly_type: string; onhand: number | null; sellable: number | null;
  gap: number | null; feed_target: number | null; detail: string | null;
  email_subject: string | null; email_body: string | null; status: string;
  last_seen_run_at: string; seen_count: number;
};

const ANOMALY_LABEL: Record<string, string> = {
  phantom_onhand: "Phantom OnHand",
  infinite_stock: "Infinite Stock",
  allocation: "Allocated",
  unmatched: "No Mintsoft SKU",
  other: "Other",
};

function num(n: number | null | undefined) {
  return n == null ? "—" : n.toLocaleString();
}

const SupplierFeeds = () => {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: feeds, isLoading: feedsLoading } = useQuery({
    queryKey: ["supplier-feeds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_feeds").select("*").order("supplier");
      if (error) throw error;
      return data as Feed[];
    },
  });

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ["supplier-feed-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_runs").select("id, run_type, status, started_at, finished_at, summary")
        .like("run_type", "supplier-feed-%")
        .order("started_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data as Run[];
    },
  });

  const { data: anomalies, isLoading: anomLoading } = useQuery({
    queryKey: ["supplier-feed-anomalies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_feed_anomalies").select("*")
        .neq("status", "resolved")
        .order("gap", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Anomaly[];
    },
  });

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("supplier_feed_anomalies")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["supplier-feed-anomalies"] });
      toast({ title: "Marked resolved" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const markEmailed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("supplier_feed_anomalies").update({ status: "emailed" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supplier-feed-anomalies"] }),
  });

  // Build Mintsoft's Product Upload CSV to turn OFF Infinite Stock for the affected
  // SKUs (existing SKU + InfiniteStock=FALSE; all other columns blank = unchanged).
  const downloadInfiniteStockCsv = () => {
    const rows = (anomalies ?? []).filter((a) => a.anomaly_type === "infinite_stock");
    if (!rows.length) return;
    const cols = PRODUCT_UPLOAD_HEADER.split(",");
    const skuIdx = cols.indexOf("SKU"), infIdx = cols.indexOf("InfiniteStock");
    const lines = [PRODUCT_UPLOAD_HEADER, ...rows.map((a) => {
      const r = new Array(cols.length).fill("");
      r[skuIdx] = a.sku; r[infIdx] = "FALSE";
      return r.join(",");
    })];
    downloadCsv(`ProductUpload-InfiniteStock-Off-${new Date().toISOString().slice(0, 10)}.csv`, lines);
  };

  // Build Mintsoft's bulk Transfer CSV moving the stuck qty (gap) Unassigned→Primary.
  const downloadTransferCsv = () => {
    const rows = (anomalies ?? []).filter((a) => (a.gap ?? 0) > 0);
    if (!rows.length) return;
    const lines = [TRANSFER_HEADER, ...rows.map((a) =>
      `${CLIENT_NAME},${a.sku},,,,${a.gap},Remote Warehouse,Unassigned,Remote Warehouse,Primary`)];
    downloadCsv(`TransferTemplate-filled-${new Date().toISOString().slice(0, 10)}.csv`, lines);
  };

  const copyEmail = async (a: Anomaly) => {
    const subject = a.email_subject ?? `Stock reconciliation required — ${a.sku}`;
    const body = a.email_body ??
      `Please reconcile stock for ${a.sku} in the Remote Warehouse (OnHand ${num(a.onhand)} vs sellable ${num(a.sellable)}).`;
    const text = `To: ${MINTSOFT_SUPPORT}\nSubject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Email copied", description: `Paste into your email or Mintsoft support (${a.sku}).` });
      markEmailed.mutate(a.id);
    } catch {
      toast({ title: "Copy failed", description: "Select and copy the email manually.", variant: "destructive" });
    }
  };

  const runSummaryLine = (s: any) => {
    if (!s) return "";
    const w = s.written ?? s.total_updated ?? 0;
    const f = s.failed ?? s.total_failed ?? 0;
    const parts = [`${w} written`];
    if (s.noop != null) parts.push(`${s.noop} noop`);
    if (f) parts.push(`${f} failed`);
    return parts.join(" · ");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Supplier Feeds</h1>
        <p className="text-foreground/60 mt-2">
          Supplier stock feeds equalised into the Remote Warehouse, run history, and issues to action.
        </p>
      </div>

      {/* Anomalies — the actionable bit */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Issues to action {anomalies?.length ? `(${anomalies.length})` : ""}
          </CardTitle>
          <CardDescription>
            SKUs a feed run couldn't equalise. Each type has a one-click fix: Copy email to paste to Mintsoft support (phantom OnHand), or a ready-to-upload CSV (Infinite Stock / Transfer). Mark Resolve when done.
          </CardDescription>
          {!!anomalies?.length && (
            <div className="flex flex-wrap gap-2 pt-2">
              {(() => {
                const infN = anomalies.filter((a) => a.anomaly_type === "infinite_stock").length;
                const trN = anomalies.filter((a) => (a.gap ?? 0) > 0).length;
                return (
                  <>
                    <Button size="sm" variant="outline" disabled={!infN} onClick={downloadInfiniteStockCsv}>
                      <Download className="h-3.5 w-3.5 mr-1" /> Infinite-Stock fix CSV{infN ? ` (${infN})` : ""}
                    </Button>
                    <Button size="sm" variant="outline" disabled={!trN} onClick={downloadTransferCsv}>
                      <Download className="h-3.5 w-3.5 mr-1" /> Transfer CSV{trN ? ` (${trN})` : ""}
                    </Button>
                  </>
                );
              })()}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {anomLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !anomalies?.length ? (
            <p className="text-sm text-foreground/60">No open issues — everything equalised cleanly. 🎉</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead className="text-right">OnHand</TableHead>
                  <TableHead className="text-right">Sellable</TableHead>
                  <TableHead className="text-right">Gap</TableHead>
                  <TableHead className="text-right">Feed</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anomalies.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.sku}</TableCell>
                    <TableCell>
                      <Badge variant={a.anomaly_type === "phantom_onhand" ? "destructive" : "secondary"}>
                        {ANOMALY_LABEL[a.anomaly_type] ?? a.anomaly_type}
                      </Badge>
                      {a.status === "emailed" && <span className="ml-2 text-xs text-foreground/50">emailed</span>}
                    </TableCell>
                    <TableCell className="text-right">{num(a.onhand)}</TableCell>
                    <TableCell className="text-right">{num(a.sellable)}</TableCell>
                    <TableCell className="text-right font-medium">{num(a.gap)}</TableCell>
                    <TableCell className="text-right">{num(a.feed_target)}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-foreground/60" title={a.detail ?? ""}>
                      {a.detail}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {a.anomaly_type === "phantom_onhand" && (
                        <Button size="sm" variant="outline" className="mr-2" onClick={() => copyEmail(a)}>
                          <Copy className="h-3.5 w-3.5 mr-1" /> Copy email
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => resolve.mutate(a.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Resolve
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Feeds registry */}
      <Card>
        <CardHeader>
          <CardTitle>Feeds</CardTitle>
          <CardDescription>Configured supplier feeds and their last run.</CardDescription>
        </CardHeader>
        <CardContent>
          {feedsLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Mapping</TableHead>
                  <TableHead>Warehouse / Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feeds?.map((f) => (
                  <TableRow key={f.supplier}>
                    <TableCell className="font-medium">{f.display_name ?? f.supplier}</TableCell>
                    <TableCell className="capitalize">{f.mapping_kind}</TableCell>
                    <TableCell>WH{f.warehouse_id} / {f.location_name}</TableCell>
                    <TableCell>
                      <Badge variant={f.enabled ? "default" : "secondary"}>{f.enabled ? "Enabled" : "Off"}</Badge>
                    </TableCell>
                    <TableCell className="text-foreground/70">
                      {f.last_run_at ? `${formatDistanceToNow(new Date(f.last_run_at))} ago — ${runSummaryLine(f.last_run_summary)}` : "never"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Run history */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Recent runs</CardTitle>
          <CardDescription>Last 20 feed runs.</CardDescription>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : !runs?.length ? (
            <p className="text-sm text-foreground/60">No runs recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Feed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-foreground/70">{formatDistanceToNow(new Date(r.started_at))} ago</TableCell>
                    <TableCell>{r.run_type.replace("supplier-feed-", "").replace("-local", "")}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "complete" ? "default" : r.status === "error" ? "destructive" : "secondary"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-foreground/70">{runSummaryLine(r.summary)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SupplierFeeds;
