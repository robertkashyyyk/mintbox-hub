/**
 * Listing Queue — what's queued for listing (from Opportunities "Push to list").
 * Pending items are grouped per store; "Generate file" builds that store's 3D GTC
 * import CSV, downloads it, and marks the items generated. (O3b-final will auto-
 * drop the file on SFTP once the import path is confirmed.)
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ListChecks, Download, Loader2, Trash2, CheckCircle2 } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { ListingData, StoreCfg, buildGtcCsv, downloadCsv } from "@/lib/gtc";

interface QRow { id: string; sku: string; store_id: string; status: string; queued_at: string; generated_at: string | null; threeds_stores: { store_name: string } | null }

export default function ListingQueue() {
  const qc = useQueryClient();
  const [genStore, setGenStore] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["listing-queue"],
    queryFn: async (): Promise<QRow[]> => {
      const { data, error } = await (supabase as any).from("listing_queue")
        .select("id, sku, store_id, status, queued_at, generated_at, threeds_stores(store_name)")
        .order("queued_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data as QRow[];
    },
  });

  const pending = rows.filter(r => r.status === "pending");
  const history = rows.filter(r => r.status !== "pending").slice(0, 100);

  // Pending grouped by store.
  const byStore = useMemo(() => {
    const m = new Map<string, { storeName: string; items: QRow[] }>();
    for (const r of pending) {
      const g = m.get(r.store_id) ?? { storeName: r.threeds_stores?.store_name ?? r.store_id, items: [] };
      g.items.push(r); m.set(r.store_id, g);
    }
    return [...m.entries()];
  }, [pending]);

  const cancel = useMutation({
    mutationFn: async (id: string) => { const { error } = await (supabase as any).from("listing_queue").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["listing-queue"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  async function generateStore(storeId: string, storeName: string, items: QRow[]) {
    setGenStore(storeId);
    try {
      const skus = items.map(i => i.sku);
      const { data: ld, error: e1 } = await (supabase as any).rpc("get_listing_data_for_skus", { p_skus: skus });
      if (e1) throw e1;
      const { data: cfgRows } = await (supabase as any).from("ebay_listing_config").select("*").eq("store_id", storeId);
      const cfg = (cfgRows?.[0] ?? undefined) as StoreCfg | undefined;
      const csv = buildGtcCsv(((ld ?? []) as ListingData[]).map(d => ({ data: d, cfg })));
      downloadCsv(`gtc-${storeName.replace(/[^a-z0-9]/gi, "_")}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      const { error: e2 } = await (supabase as any).from("listing_queue")
        .update({ status: "generated", generated_at: new Date().toISOString() }).in("id", items.map(i => i.id));
      if (e2) throw e2;
      toast.success(`Generated ${items.length} listing(s) for ${storeName}`);
      qc.invalidateQueries({ queryKey: ["listing-queue"] });
    } catch (e: any) { toast.error(e.message); } finally { setGenStore(null); }
  }

  return (
    <div className="space-y-6">
      <ModuleHeader title="Listing Queue" description="SKUs queued from Opportunities. Generate each store's 3D GTC import file, then (soon) it auto-drops on SFTP." icon={ListChecks} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Pending" value={pending.length.toLocaleString()} className="text-amber-400" />
        <Stat label="Stores with pending" value={byStore.length.toLocaleString()} />
        <Stat label="Generated / listed" value={rows.filter(r => r.status === "generated" || r.status === "listed").length.toLocaleString()} className="text-emerald-400" />
      </div>

      {isLoading ? <PageLoader rows={6} columns={[120, 120, 100, 80]} label="Loading queue" /> : (<>
        {byStore.length === 0 && <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Nothing pending. Push SKUs from Opportunities to queue them.</CardContent></Card>}
        {byStore.map(([storeId, g]) => (
          <Card key={storeId} className="border-pd-accent/30">
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <div><CardTitle className="text-base">{g.storeName} ({g.items.length})</CardTitle><CardDescription>Pending listings for this store.</CardDescription></div>
              <Button size="sm" disabled={genStore === storeId} onClick={() => generateStore(storeId, g.storeName, g.items)}>
                {genStore === storeId ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}Generate file ({g.items.length})
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Queued</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {g.items.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.queued_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right"><Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => cancel.mutate(r.id)}><Trash2 className="h-3 w-3" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}

        {history.length > 0 && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Recent</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Store</TableHead><TableHead>Status</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
                <TableBody>
                  {history.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell className="text-sm">{r.threeds_stores?.store_name ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={`text-xs ${r.status === "listed" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : r.status === "failed" ? "text-destructive" : ""}`}>{r.status === "listed" && <CheckCircle2 className="h-3 w-3 mr-1" />}{r.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.generated_at ?? r.queued_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </>)}
    </div>
  );
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (<Card><CardContent className="pt-6"><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className={`text-2xl font-bold mt-1 ${className}`}>{value}</div></CardContent></Card>);
}
