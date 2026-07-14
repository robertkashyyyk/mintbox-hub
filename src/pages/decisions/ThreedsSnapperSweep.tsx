import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, Wand2 } from "lucide-react";

// Snapper-Only sweep: charm-hygiene across ALL live eBay listings (not just sold).
// Reads the nightly `charm_snap_candidates` matview (costed, active-eBay, non-charm,
// UP-snap target precomputed) and pushes a chunk per store via the existing SFTP push.
// Up-only + exclude-no-cost — so it can never reduce a price or breach an unknown floor.

const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

interface StoreSummary {
  store_id: string; store_name: string; listings: number; in_stock: number; total_uplift: number;
}
interface Candidate {
  store_id: string; store_name: string; sku: string; item_id: string | null;
  current_price: number; new_price: number; uplift: number;
  cost_price: number | null; current_stock: number | null; url: string | null;
}

export default function ThreedsSnapperSweep() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [batch, setBatch] = useState(1500);
  const [inStockOnly, setInStockOnly] = useState(true);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const { data: stores, isLoading: storesLoading } = useQuery({
    queryKey: ["charm_snap_stores"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("charm_snap_store_summary");
      if (error) throw error;
      const rows = (data ?? []) as StoreSummary[];
      if (!storeId && rows.length) setStoreId(rows[0].store_id); // default to the biggest
      return rows;
    },
  });

  const { data: rows, isLoading: rowsLoading, isFetching } = useQuery({
    queryKey: ["charm_snap_rows", storeId, batch, inStockOnly],
    enabled: !!storeId,
    queryFn: async () => {
      let q = (supabase as any)
        .from("charm_snap_candidates")
        .select("store_id, store_name, sku, item_id, current_price, new_price, uplift, cost_price, current_stock, url")
        .eq("store_id", storeId)
        .order("uplift", { ascending: false })
        .limit(Math.min(Math.max(batch, 1), 5000));
      if (inStockOnly) q = q.gt("current_stock", 0);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Candidate[];
    },
  });

  const selectedRows = useMemo(
    () => (rows ?? []).filter((r) => checked[r.sku]),
    [rows, checked],
  );
  const allChecked = (rows ?? []).length > 0 && (rows ?? []).every((r) => checked[r.sku]);
  const toggleAll = (v: boolean) =>
    setChecked(v ? Object.fromEntries((rows ?? []).map((r) => [r.sku, true])) : {});

  const activeStore = stores?.find((s) => s.store_id === storeId);

  const pushMutation = useMutation({
    mutationFn: async () => {
      if (!storeId || selectedRows.length === 0) throw new Error("Pick a store and tick some rows");
      const pushRows = selectedRows.map((r) => ({ sku: r.sku, new_price: r.new_price }));
      const { data, error } = await supabase.functions.invoke("threeds-reprice-push", {
        body: { store_id: storeId, rows: pushRows, source: "charm_snap" },
      });
      if (error || (data as any)?.error) throw new Error(error?.message ?? (data as any)?.error ?? "push failed");
      return data as { added: number; row_count: number; sftp_path: string };
    },
    onSuccess: (d) => {
      toast({
        title: "Snapped prices pushed to 3D",
        description: `${d.added} charm prices queued for ${activeStore?.store_name} (file now holds ${d.row_count}). Cleared once 3D confirms them live.`,
      });
      setChecked({});
      qc.invalidateQueries({ queryKey: ["threeds_pending"] });
    },
    onError: (e: Error) => toast({ title: "Push failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-pd-accent" /> Snapper-Only — charm-price sweep
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
              Every <strong>live eBay listing</strong> whose price isn't already a charm price, snapped <strong>up</strong> to the
              next charm rung (never reduced). Costed listings only. Worst-uplift first — work a store's chunk, push, repeat
              daily until clean. {activeStore && (
                <>· <strong>{activeStore.store_name}</strong>: {activeStore.listings.toLocaleString()} to snap
                ({activeStore.in_stock.toLocaleString()} in stock).</>
              )}
            </p>
          </div>
          <Button
            onClick={() => pushMutation.mutate()}
            disabled={pushMutation.isPending || isFetching || selectedRows.length === 0}
            className="shrink-0"
          >
            {pushMutation.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Pushing…</>
              : <><Upload className="h-4 w-4 mr-2" /> Push {selectedRows.length} to 3D</>}
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-4 pt-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Store</label>
            <Select value={storeId ?? undefined} onValueChange={(v) => { setStoreId(v); setChecked({}); }}>
              <SelectTrigger className="w-56 h-9"><SelectValue placeholder="Pick a store" /></SelectTrigger>
              <SelectContent>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.store_id} value={s.store_id}>
                    {s.store_name} · {s.listings.toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Batch size</label>
            <Input type="number" min={1} max={5000} step={100} value={batch}
              onChange={(e) => { setBatch(parseInt(e.target.value || "0", 10) || 0); setChecked({}); }}
              className="w-28 h-9" />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground h-9">
            <Switch checked={inStockOnly} onCheckedChange={(v) => { setInStockOnly(v); setChecked({}); }} />
            In-stock only
          </label>
        </div>
      </CardHeader>

      <CardContent className={`overflow-x-auto transition-opacity ${isFetching ? "opacity-50 pointer-events-none" : ""}`}>
        {storesLoading || rowsLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (rows ?? []).length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nothing to snap for this store / filter — it's charm-clean. 🎉
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground mb-2">
              Showing {rows!.length.toLocaleString()} (top {batch.toLocaleString()} by uplift)
              {inStockOnly ? ", in stock" : ""} · {selectedRows.length} selected
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox checked={allChecked} onCheckedChange={(v) => toggleAll(!!v)} /></TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Current £</TableHead>
                  <TableHead className="text-right">New £</TableHead>
                  <TableHead className="text-right">Uplift</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows!.map((r) => (
                  <TableRow key={r.sku}>
                    <TableCell>
                      <Checkbox checked={!!checked[r.sku]}
                        onCheckedChange={(v) => setChecked((p) => ({ ...p, [r.sku]: !!v }))} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                    <TableCell className="text-right">{gbp(r.current_price)}</TableCell>
                    <TableCell className="text-right font-medium text-pd-accent">{gbp(r.new_price)}</TableCell>
                    <TableCell className="text-right text-success">+{gbp(r.uplift)}</TableCell>
                    <TableCell className="text-right">
                      {r.current_stock ?? 0}
                      {(r.current_stock ?? 0) === 0 && <Badge variant="secondary" className="ml-1 text-[10px]">OOS</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
