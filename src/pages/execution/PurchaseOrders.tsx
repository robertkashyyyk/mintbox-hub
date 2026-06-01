import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/PageLoader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Search, RefreshCw, Truck, ChevronRight, ChevronDown, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface POSummary {
  id: string;
  po_number: string | null;
  status: string;
  supplier_id: string | null;
  total_qty: number;
  total_cost: number;
  created_at: string;
  sent_at: string | null;
  mintsoft_po_id: number | null;
  supplier_name?: string | null;
}

interface TodaysAsnRow {
  asn_id: number;
  sku: string;
  qty: number;
  status: string | null;
  asn_date: string | null;
  asn_reference: string | null;
  captured_at: string;
}


interface POSummary {
  id: string;
  po_number: string | null;
  status: string;
  supplier_id: string | null;
  total_qty: number;
  total_cost: number;
  created_at: string;
  sent_at: string | null;
  mintsoft_po_id: number | null;
  supplier_name?: string | null;
}

const statusBadge = (s: string) => {
  switch (s) {
    case "draft": return <Badge variant="outline">Draft</Badge>;
    case "approved": return <Badge variant="secondary">Approved</Badge>;
    case "sent": return <Badge className="bg-pd-accent text-pd-accent-foreground">Sent — Awaiting ASN</Badge>;
    case "partial": return <Badge className="bg-warning text-warning-foreground">Partial</Badge>;
    case "complete": return <Badge variant="secondary">Complete</Badge>;
    case "cancelled": return <Badge variant="destructive">Cancelled</Badge>;
    default: return <Badge variant="outline">{s}</Badge>;
  }
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n || 0);

const PurchaseOrders = () => {
  const [search, setSearch] = useState("");
  const [resyncing, setResyncing] = useState(false);
  const [view, setView] = useState<"pos" | "asns">("pos");
  const [expandedAsn, setExpandedAsn] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [refreshingAsns, setRefreshingAsns] = useState(false);

  const deletePo = async (po: POSummary) => {
    setDeletingId(po.id);
    try {
      const { error } = await (supabase as any)
        .from("purchase_orders")
        .delete()
        .eq("id", po.id);
      if (error) throw error;
      toast({
        title: "PO deleted",
        description: po.mintsoft_po_id
          ? `Removed locally. Note: PO #${po.mintsoft_po_id} still exists in Mintsoft.`
          : `Removed ${po.po_number || po.id.slice(0, 8)}.`,
      });
      // refetch
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      poQuery.refetch();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const resyncTodaysStock = async () => {
    setResyncing(true);
    try {
      toast({ title: "Resyncing today's ASN stock…", description: "Pulling local + Mintsoft-side ASNs." });
      const { data, error } = await supabase.functions.invoke("resync-todays-asn-stock", { body: {} });
      if (error) throw error;
      const d: any = data || {};
      if (!d.union_skus) {
        toast({ title: "Nothing to resync", description: d.message || "No ASN activity today." });
        return;
      }
      toast({
        title: d.queued ? "Stock resync queued" : "Stock resync complete",
        description: d.queued
          ? `Queued ${d.union_skus} SKU${d.union_skus === 1 ? "" : "s"} from ${d.local_po_count} local PO(s) + ${d.mintsoft_asn_count} Mintsoft ASN(s).`
          : `Updated ${d.updated ?? 0} of ${d.union_skus} SKUs · ${d.local_po_count} local PO(s) + ${d.mintsoft_asn_count} Mintsoft ASN(s).`,
      });
    } catch (e: any) {
      toast({ title: "Resync failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setResyncing(false);
    }
  };

  const refreshTodaysAsns = async () => {
    setRefreshingAsns(true);
    try {
      const { error } = await supabase.functions.invoke("mintsoft-fetch-todays-asns", { body: {} });
      if (error) throw error;
      toast({ title: "Today's ASNs refreshed", description: "Buy recommendations updated." });
      asnsQuery.refetch();
    } catch (e: any) {
      toast({ title: "ASN refresh failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setRefreshingAsns(false);
    }
  };

  const asnsQuery = useQuery({
    queryKey: ["todays-open-asns"],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb
        .from("todays_open_asns")
        .select("asn_id, sku, qty, status, asn_date, asn_reference, captured_at")
        .order("asn_id", { ascending: false })
        .order("sku", { ascending: true });
      if (error) throw error;
      return (data || []) as TodaysAsnRow[];
    },
    refetchInterval: 60_000,
  });
  const todaysAsns = asnsQuery.data ?? [];

  const poQuery = useQuery({
    queryKey: ["po-list"],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb
        .from("purchase_orders")
        .select("id, po_number, status, supplier_id, total_qty, total_cost, created_at, sent_at, mintsoft_po_id, suppliers(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []).map((r: any) => ({
        ...r,
        supplier_name: r.suppliers?.name ?? null,
      })) as POSummary[];
    },
  });
  const pos = poQuery.data ?? [];
  const isLoading = poQuery.isLoading;


  const filtered = useMemo(() => {
    if (!search.trim()) return pos;
    const q = search.toLowerCase();
    return pos.filter((p) =>
      (p.po_number || "").toLowerCase().includes(q) ||
      (p.supplier_name || "").toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q)
    );
  }, [pos, search]);

  const groupedAsns = useMemo(() => {
    const map = new Map<number, { asn_id: number; asn_reference: string | null; status: string | null; asn_date: string | null; lines: TodaysAsnRow[]; total_qty: number }>();
    for (const r of todaysAsns) {
      const existing = map.get(r.asn_id);
      if (existing) {
        existing.lines.push(r);
        existing.total_qty += Number(r.qty) || 0;
      } else {
        map.set(r.asn_id, {
          asn_id: r.asn_id,
          asn_reference: r.asn_reference,
          status: r.status,
          asn_date: r.asn_date,
          lines: [r],
          total_qty: Number(r.qty) || 0,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.asn_id - a.asn_id);
  }, [todaysAsns]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Purchase Orders &amp; ASNs</h1>
          <p className="text-foreground/60">
            Drafts, sent POs awaiting ASN, and today's open Mintsoft ASNs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={resyncTodaysStock} disabled={resyncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${resyncing ? "animate-spin" : ""}`} />
            {resyncing ? "Resyncing…" : "Resync today's PO stock"}
          </Button>
          <Button variant="outline" asChild>
            <Link to="/decisions/buying">+ Create from recommendations</Link>
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(v) => v && setView(v as "pos" | "asns")}
          className="border rounded-md"
        >
          <ToggleGroupItem value="pos" className="data-[state=on]:bg-pd-accent data-[state=on]:text-pd-accent-foreground px-4">
            Purchase Orders
          </ToggleGroupItem>
          <ToggleGroupItem value="asns" className="data-[state=on]:bg-pd-accent data-[state=on]:text-pd-accent-foreground px-4">
            ASNs ({groupedAsns.length})
          </ToggleGroupItem>
        </ToggleGroup>

        {view === "pos" ? (
          <div className="relative max-w-md flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search PO #, supplier or status…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={refreshTodaysAsns} disabled={refreshingAsns}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshingAsns ? "animate-spin" : ""}`} />
            {refreshingAsns ? "Refreshing…" : "Refresh now"}
          </Button>
        )}
      </div>

      {view === "pos" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{filtered.length} purchase orders</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <PageLoader rows={6} columns={[100, 120, 180, 80, 80, 80]} label="Loading purchase orders" />
            ) : filtered.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center">No purchase orders yet.</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO #</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((po) => (
                      <TableRow key={po.id}>
                        <TableCell className="font-mono text-xs">{po.po_number || po.id.slice(0, 8)}</TableCell>
                        <TableCell>{po.supplier_name || "—"}</TableCell>
                        <TableCell>{statusBadge(po.status)}</TableCell>
                        <TableCell className="text-right">{po.total_qty}</TableCell>
                        <TableCell className="text-right">{fmt(Number(po.total_cost))}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(po.created_at).toLocaleDateString("en-GB")}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {po.sent_at ? new Date(po.sent_at).toLocaleDateString("en-GB") : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/execution/purchase-orders/${po.id}`}>Open</Link>
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  disabled={deletingId === po.id}
                                  title="Delete PO"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete this PO?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {po.mintsoft_po_id ? (
                                      <>
                                        This PO was already sent to Mintsoft (#{po.mintsoft_po_id}).
                                        Deleting here removes it locally only — the Mintsoft PO will remain
                                        and must be cancelled there separately.
                                      </>
                                    ) : (
                                      <>This will permanently remove {po.po_number || po.id.slice(0, 8)} and all its lines. This cannot be undone.</>
                                    )}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deletePo(po)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="h-4 w-4 text-pd-accent" />
              Today's open ASNs (Mintsoft) — {groupedAsns.length} ASN{groupedAsns.length === 1 ? "" : "s"}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              ASNs raised in Mintsoft today with an open status. These offset buy recommendations until they're booked in. Auto-refreshes every 15 min; wiped nightly at 21:00 UK.
            </p>
          </CardHeader>
          <CardContent>
            {asnsQuery.isLoading ? (
              <p className="text-muted-foreground py-4 text-center text-sm">Loading…</p>
            ) : groupedAsns.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-sm">No open ASNs raised in Mintsoft today.</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>ASN</TableHead>
                      <TableHead>Ref</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Total Qty</TableHead>
                      <TableHead>ASN date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedAsns.map((a) => {
                      const open = expandedAsn === a.asn_id;
                      return (
                        <Fragment key={a.asn_id}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => setExpandedAsn(open ? null : a.asn_id)}
                          >
                            <TableCell>
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </TableCell>
                            <TableCell className="font-mono text-xs">{a.asn_id}</TableCell>
                            <TableCell className="text-xs">{a.asn_reference || "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{a.status || "OPEN"}</Badge>
                            </TableCell>
                            <TableCell className="text-right">{a.lines.length}</TableCell>
                            <TableCell className="text-right font-medium">{a.total_qty}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {a.asn_date ? new Date(a.asn_date).toLocaleString("en-GB") : "—"}
                            </TableCell>
                          </TableRow>
                          {open && (
                            <TableRow key={`${a.asn_id}-detail`} className="bg-muted/20">
                              <TableCell />
                              <TableCell colSpan={6} className="p-0">
                                <div className="px-4 py-3">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>SKU</TableHead>
                                        <TableHead className="text-right">Qty</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {a.lines.map((l) => (
                                        <TableRow key={`${a.asn_id}-${l.sku}`}>
                                          <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                                          <TableCell className="text-right">{Number(l.qty)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PurchaseOrders;
