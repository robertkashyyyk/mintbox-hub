import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, AlertTriangle } from "lucide-react";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }).format(n || 0);

const PurchaseOrderDetail = () => {
  const { id } = useParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, { qty?: number; cost?: number }>>({});

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["po-detail", id],
    queryFn: async () => {
      const sb = supabase as any;
      const [poRes, linesRes] = await Promise.all([
        sb.from("purchase_orders")
          .select("*, suppliers(name, contact_email, ordering_method, mintsoft_supplier_id)")
          .eq("id", id).single(),
        sb.from("purchase_order_lines")
          .select("*")
          .eq("po_id", id)
          .order("sku"),
      ]);
      if (poRes.error) throw poRes.error;
      if (linesRes.error) throw linesRes.error;
      const lines = (linesRes.data || []) as any[];
      const skus = lines.map((l) => l.sku);
      let pidMap: Record<string, number> = {};
      if (skus.length) {
        const { data: pcs } = await sb.from("products_cache")
          .select("sku, mintsoft_product_id").in("sku", skus);
        for (const r of pcs || []) {
          if (r.mintsoft_product_id) pidMap[r.sku] = r.mintsoft_product_id;
        }
      }
      return { po: poRes.data as any, lines, pidMap };
    },
    enabled: !!id,
  });

  const saveLine = useMutation({
    mutationFn: async ({ lineId, patch, sku, mintsoftProductId, pushCost }:
      { lineId: string; patch: any; sku: string; mintsoftProductId?: number; pushCost?: number }) => {
      const sb = supabase as any;
      const { error } = await sb.from("purchase_order_lines").update(patch).eq("id", lineId);
      if (error) throw error;

      // If a cost was edited and we have a Mintsoft product id, push to Mintsoft
      // (this also mirrors back into products_cache automatically).
      if (pushCost && pushCost > 0 && mintsoftProductId) {
        const { data, error: fnErr } = await supabase.functions.invoke("update-product-cost", {
          body: { items: [{ mintsoft_product_id: mintsoftProductId, sku, cost_price: pushCost }] },
        });
        if (fnErr) throw new Error(fnErr.message);
        const result = (data as any)?.results?.[0];
        if (result && !result.ok) throw new Error(result.error || "Mintsoft cost push failed");
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["po-detail", id] });
      setEdits((prev) => {
        const { [vars.lineId]: _drop, ...rest } = prev;
        return rest;
      });
      if (vars.pushCost) {
        toast({ title: "Cost saved", description: `${vars.sku} updated and pushed to Mintsoft.` });
      }
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const sendPo = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("mintsoft-create-po", {
        body: { po_id: id },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { mintsoft_po_id?: number; lines_sent?: number; skipped?: { sku: string; reason: string }[] };
    },
    onSuccess: (data) => {
      const skipped = data?.skipped?.length || 0;
      toast({
        title: "PO sent to Mintsoft",
        description: `Mintsoft PO #${data?.mintsoft_po_id ?? "?"} created · ${data?.lines_sent} lines${skipped ? ` · ${skipped} skipped (fix and resend)` : ""}.`,
      });
      refetch();
    },
    onError: (e: any) => toast({ title: "Cannot send to Mintsoft", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Loading PO…</div>;

  const { po, lines, pidMap } = data;
  const linesMissingCost = lines.filter((l) => !l.unit_cost || Number(l.unit_cost) <= 0);
  const linesNoMintsoftId = lines.filter((l) => !pidMap[l.sku]);
  const supplierMapped = !!po.suppliers?.mintsoft_supplier_id;
  const sendableLines = lines.filter((l) =>
    pidMap[l.sku] && Number(l.unit_cost || 0) > 0 && Number(l.qty_ordered || 0) > 0
  );
  const canSend = po.status === "draft" || po.status === "approved";
  const totalQty = lines.reduce((a, l) => a + Number(l.qty_ordered || 0), 0);
  const totalCost = lines.reduce((a, l) => a + Number(l.qty_ordered || 0) * Number(l.unit_cost || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2">
            <Link to="/execution/purchase-orders"><ArrowLeft className="h-4 w-4" /> Back to POs</Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {po.po_number || `PO ${po.id.slice(0, 8)}`}
          </h1>
          <p className="text-foreground/60">
            Supplier: <span className="text-foreground">{po.suppliers?.name || "—"}</span>
            {po.suppliers?.ordering_method && <> · Method: <span className="text-foreground">{po.suppliers.ordering_method}</span></>}
            {po.suppliers && (
              <> · Mintsoft: <span className={supplierMapped ? "text-foreground" : "text-destructive"}>
                {supplierMapped ? `#${po.suppliers.mintsoft_supplier_id}` : "not mapped"}
              </span></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={po.status === "sent" ? "default" : "outline"} className="text-sm">
            {po.status}
            {po.status === "sent" && !po.mintsoft_po_id && " — Awaiting ASN"}
            {po.status === "sent" && po.mintsoft_po_id && ` — Mintsoft #${po.mintsoft_po_id}`}
          </Badge>
          {canSend && (
            <Button
              disabled={sendPo.isPending || sendableLines.length === 0 || !supplierMapped}
              onClick={() => sendPo.mutate()}>
              <Send className="h-4 w-4 mr-2" />
              {sendPo.isPending ? "Sending…" : `Send to Mintsoft${sendableLines.length < lines.length ? ` (${sendableLines.length}/${lines.length})` : ""}`}
            </Button>
          )}
        </div>
      </div>

      {po.status === "sent" && !po.mintsoft_po_id && (
        <Alert>
          <AlertTitle>Awaiting Mintsoft ASN</AlertTitle>
          <AlertDescription>
            These SKUs are suppressed from buy recommendations until Mintsoft confirms the inbound stock.
          </AlertDescription>
        </Alert>
      )}

      {po.mintsoft_send_error && canSend && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Last Mintsoft send failed</AlertTitle>
          <AlertDescription>{po.mintsoft_send_error}</AlertDescription>
        </Alert>
      )}

      {!supplierMapped && canSend && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Supplier not mapped to Mintsoft</AlertTitle>
          <AlertDescription>
            "{po.suppliers?.name}" has no Mintsoft Supplier ID. Open Suppliers admin and set it before sending —
            without it Mintsoft cannot accept the PO.
          </AlertDescription>
        </Alert>
      )}

      {linesMissingCost.length > 0 && canSend && (
        <Alert className="border-warning/50">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle>{linesMissingCost.length} line{linesMissingCost.length === 1 ? "" : "s"} missing cost</AlertTitle>
          <AlertDescription>
            These lines will be skipped when sending to Mintsoft. Edit the cost and click Save — it will be
            pushed to Mintsoft and removed from Missing Costs automatically. Then click Send to Mintsoft again
            to push the remaining lines.
          </AlertDescription>
        </Alert>
      )}

      {linesNoMintsoftId.length > 0 && canSend && (
        <Alert className="border-warning/50">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle>{linesNoMintsoftId.length} SKU{linesNoMintsoftId.length === 1 ? "" : "s"} not in Mintsoft yet</AlertTitle>
          <AlertDescription>
            These will be skipped on send: {linesNoMintsoftId.slice(0, 6).map((l) => l.sku).join(", ")}
            {linesNoMintsoftId.length > 6 && ` +${linesNoMintsoftId.length - 6} more`}.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Lines ({lines.length})</CardTitle>
          <div className="text-sm text-muted-foreground">
            {totalQty} units · <span className="text-foreground font-medium">{fmt(totalCost)}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Stock @ snap</TableHead>
                  <TableHead className="text-right">BO @ snap</TableHead>
                  <TableHead className="text-right">LSA @ snap</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const e = edits[l.id] || {};
                  const qty = e.qty ?? Number(l.qty_ordered);
                  const cost = e.cost ?? Number(l.unit_cost || 0);
                  const dirty = e.qty !== undefined || e.cost !== undefined;
                  const lineTotal = qty * cost;
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Link to={`/discovery/products/${l.sku}`} className="text-primary hover:underline font-mono text-xs">
                          {l.sku}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{l.product_name || "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{l.snapshot_live_stock ?? "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{l.snapshot_back_orders ?? "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{l.snapshot_low_stock_alert ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number" min={0}
                          disabled={!canSend}
                          value={qty}
                          onChange={(ev) => setEdits({ ...edits, [l.id]: { ...e, qty: Number(ev.target.value) } })}
                          className="h-8 w-20 ml-auto text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number" min={0} step="0.01"
                          disabled={!canSend}
                          value={cost}
                          onChange={(ev) => setEdits({ ...edits, [l.id]: { ...e, cost: Number(ev.target.value) } })}
                          className={`h-8 w-24 ml-auto text-right ${(!cost || cost <= 0) ? "border-destructive" : ""}`}
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium">{fmt(lineTotal)}</TableCell>
                      <TableCell>
                        {dirty && (
                          <Button variant="outline" size="sm"
                            onClick={() => saveLine.mutate({
                              lineId: l.id,
                              sku: l.sku,
                              mintsoftProductId: pidMap[l.sku],
                              pushCost: e.cost !== undefined && cost > 0 ? cost : undefined,
                              patch: { qty_ordered: qty, unit_cost: cost },
                            })}>
                            Save{e.cost !== undefined && pidMap[l.sku] ? " & push" : ""}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PurchaseOrderDetail;
