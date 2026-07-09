import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Flame, Info, Loader2, RotateCcw } from "lucide-react";

// "Stuck at FBA" blow-out worklist. A stuck item = we hold FBA stock, we do NOT win the Buy Box,
// and matching the Buy Box price would be below our break-even floor (winning it is a loss).
// The action: drop the eSagu min to £0.01 (repricer chases the Buy Box down and sells the stock
// through) AND flag the SKU never-FBA so the recommender won't restock it. eBay/FBM sales continue.

const fmtGBP = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(n));

type Candidate = {
  sku: string; asin: string; product_name: string | null; marketplace_id: string;
  on_hand: number; inbound: number; cost: number; breakeven_floor: number;
  buy_box_price: number; buy_box_seller: string | null; our_price: number | null;
  loss_per_unit: number; capital_at_cost: number; weekly_velocity: number | null; never_fba: boolean;
};

type ReviewRow = {
  sku: string; blown_out_at: string; campaign_price: number; original_price: number | null;
  status: string; on_hand_now: number | null; units_sold_since: number; realised_loss_since: number; never_fba: boolean;
};

export default function FbaBlowout() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["fba-blowout-candidates"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_fba_blowout_candidates");
      if (error) throw error;
      return (data ?? []) as Candidate[];
    },
  });

  const { data: review, isLoading: reviewLoading } = useQuery({
    queryKey: ["fba-blowout-review"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_fba_blowout_review");
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
  });

  const rows = candidates ?? [];
  const selectedRows = useMemo(() => rows.filter((r) => selected[r.sku]), [rows, selected]);
  const allChecked = rows.length > 0 && rows.every((r) => selected[r.sku]);
  const totals = useMemo(() => {
    const src = selectedRows.length ? selectedRows : rows;
    return {
      skus: src.length,
      units: src.reduce((a, r) => a + (r.on_hand || 0), 0),
      capital: src.reduce((a, r) => a + (r.capital_at_cost || 0), 0),
    };
  }, [rows, selectedRows]);

  const blowOutMut = useMutation({
    mutationFn: async (targets: Candidate[]) => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      const inserts = targets.map((r) => ({
        sku: r.sku, type: "liquidation", status: "active", channels: ["amazon"],
        original_price: r.our_price, campaign_price: 0.01, baseline_cost: r.cost, baseline_stock: r.on_hand,
        notes: "FBA blow-out (£0.01 floor, sell-through, never-FBA)", created_by: uid,
      }));
      const { data: camps, error: cErr } = await (supabase as any)
        .from("price_campaigns").insert(inserts).select("id,sku");
      if (cErr) throw new Error(cErr.code === "23505" ? "One or more already have an active campaign — refresh the list." : cErr.message);
      const ids = (camps ?? []).map((c: any) => c.id);
      if (ids.length) {
        const { error: eErr } = await supabase.functions.invoke("esagu-clearance", { body: { campaignIds: ids, mode: "apply", live: true } });
        if (eErr) throw new Error(`eSagu clearance failed: ${eErr.message}`);
      }
      for (const r of targets) {
        await (supabase as any).rpc("amazon_flag_never_fba", { p_sku: r.sku, p_note: "FBA blow-out" });
      }
      return targets.length;
    },
    onSuccess: (n) => {
      toast({ title: "Blown out", description: `${n} SKU${n === 1 ? "" : "s"} dropped to £0.01 on eSagu and flagged never-FBA.` });
      setSelected({});
      qc.invalidateQueries({ queryKey: ["fba-blowout-candidates"] });
      qc.invalidateQueries({ queryKey: ["fba-blowout-review"] });
    },
    onError: (e) => toast({ title: "Blow-out failed", description: String(e), variant: "destructive" }),
  });

  const restoreMut = useMutation({
    mutationFn: async (sku: string) => {
      const { data: camp } = await (supabase as any)
        .from("price_campaigns").select("id").eq("sku", sku).eq("type", "liquidation")
        .eq("status", "active").contains("channels", ["amazon"])
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (camp?.id) {
        await supabase.functions.invoke("esagu-clearance", { body: { campaignIds: [camp.id], mode: "revert", live: true } });
        await (supabase as any).from("price_campaigns").update({ status: "reverted", reverted_at: new Date().toISOString() }).eq("id", camp.id);
      }
      await (supabase as any).rpc("amazon_set_fba_exclusion", { p_sku: sku, p_reason: "", p_note: null });
      return sku;
    },
    onSuccess: (sku) => {
      toast({ title: "Restored", description: `${sku}: eSagu floor reverted and never-FBA cleared.` });
      qc.invalidateQueries({ queryKey: ["fba-blowout-candidates"] });
      qc.invalidateQueries({ queryKey: ["fba-blowout-review"] });
    },
    onError: (e) => toast({ title: "Restore failed", description: String(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-foreground/80 flex items-start gap-2">
        <Flame className="h-4 w-4 flex-shrink-0 mt-0.5 text-orange-400" />
        <span>
          Stock <strong>stuck in FBA</strong>: we hold it, we don't win the Buy Box, and winning it would mean selling
          under break-even. <strong>Blow out</strong> drops the eSagu floor to <strong>£0.01</strong> so the repricer
          chases the Buy Box down and clears the stock — and flags the SKU <strong>never-FBA</strong> so it isn't
          restocked. eBay/FBM sales carry on as normal; only FBA restocking stops. Reversible from the Blown-out tab.
        </span>
      </div>

      <Tabs defaultValue="stuck">
        <TabsList>
          <TabsTrigger value="stuck">Stuck at FBA {rows.length ? `(${rows.length})` : ""}</TabsTrigger>
          <TabsTrigger value="review">Blown out {review?.length ? `(${review.length})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="stuck">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-base">
                Stuck at FBA
                {rows.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {totals.skus} SKUs · {totals.units} units · {fmtGBP(totals.capital)} at cost
                    {selectedRows.length ? " (selected)" : ""}
                  </span>
                )}
              </CardTitle>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    disabled={selectedRows.length === 0 || blowOutMut.isPending}
                    className="bg-orange-600 hover:bg-orange-500 h-9"
                  >
                    {blowOutMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Flame className="h-4 w-4 mr-2" />}
                    Blow out {selectedRows.length || ""} & stop FBA
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Blow out {selectedRows.length} SKU{selectedRows.length === 1 ? "" : "s"}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This drops the eSagu min-price to <strong>£0.01</strong> for {selectedRows.length} SKU
                      {selectedRows.length === 1 ? "" : "s"} ({totals.units} units, {fmtGBP(totals.capital)} at cost) so the
                      repricer sells the FBA stock through at a loss, and flags each <strong>never-FBA</strong>. Live Amazon
                      prices will drop. You can reverse it per-SKU from the Blown-out tab.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-orange-600 hover:bg-orange-500" onClick={() => blowOutMut.mutate(selectedRows)}>
                      Blow out
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-64" />
              ) : rows.length === 0 ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center">
                  <Info className="h-4 w-4" /> Nothing stuck — no FBA stock is underwater against the Buy Box.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">
                          <Checkbox
                            checked={allChecked}
                            onCheckedChange={(c) => {
                              const next: Record<string, boolean> = {};
                              if (c) rows.forEach((r) => { next[r.sku] = true; });
                              setSelected(next);
                            }}
                          />
                        </TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">FBA on-hand</TableHead>
                        <TableHead className="text-right">Wk vel.</TableHead>
                        <TableHead className="text-right">Our price</TableHead>
                        <TableHead className="text-right">Buy Box</TableHead>
                        <TableHead className="text-right">Break-even</TableHead>
                        <TableHead className="text-right">Loss/unit</TableHead>
                        <TableHead className="text-right">Capital</TableHead>
                        <TableHead>Flags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.sku} data-state={selected[r.sku] ? "selected" : undefined}>
                          <TableCell>
                            <Checkbox
                              checked={!!selected[r.sku]}
                              onCheckedChange={(c) => setSelected((s) => ({ ...s, [r.sku]: !!c }))}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {r.sku}
                            {r.product_name && <div className="text-[11px] text-muted-foreground truncate max-w-[240px]">{r.product_name}</div>}
                          </TableCell>
                          <TableCell className="text-right">{r.on_hand}{r.inbound ? <span className="text-muted-foreground"> +{r.inbound}</span> : null}</TableCell>
                          <TableCell className="text-right">{r.weekly_velocity == null ? "—" : Number(r.weekly_velocity).toFixed(1)}</TableCell>
                          <TableCell className="text-right">{fmtGBP(r.our_price)}</TableCell>
                          <TableCell className="text-right">{fmtGBP(r.buy_box_price)}</TableCell>
                          <TableCell className="text-right">{fmtGBP(r.breakeven_floor)}</TableCell>
                          <TableCell className="text-right text-destructive">{fmtGBP(r.loss_per_unit)}</TableCell>
                          <TableCell className="text-right">{fmtGBP(r.capital_at_cost)}</TableCell>
                          <TableCell>
                            {r.never_fba && <Badge variant="outline" className="text-[10px] border-orange-500/50 text-orange-400">never-FBA</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Blown out — the results</CardTitle>
            </CardHeader>
            <CardContent>
              {reviewLoading ? (
                <Skeleton className="h-64" />
              ) : (review ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center">
                  <Info className="h-4 w-4" /> Nothing blown out yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Blown out</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">FBA left</TableHead>
                        <TableHead className="text-right">Sold since</TableHead>
                        <TableHead className="text-right">Realised P/L</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(review ?? []).map((r) => (
                        <TableRow key={r.sku + r.blown_out_at}>
                          <TableCell className="font-medium">{r.sku}</TableCell>
                          <TableCell className="text-muted-foreground">{new Date(r.blown_out_at).toLocaleDateString("en-GB")}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={r.status === "reverted" ? "text-muted-foreground" : "border-orange-500/50 text-orange-400"}>{r.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{r.on_hand_now ?? "—"}</TableCell>
                          <TableCell className="text-right">{Number(r.units_sold_since || 0)}</TableCell>
                          <TableCell className={`text-right ${Number(r.realised_loss_since) < 0 ? "text-destructive" : ""}`}>{fmtGBP(r.realised_loss_since)}</TableCell>
                          <TableCell className="text-right">
                            {r.status !== "reverted" && (
                              <Button size="sm" variant="ghost" disabled={restoreMut.isPending}
                                onClick={() => restoreMut.mutate(r.sku)} title="Revert eSagu floor & clear never-FBA">
                                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
