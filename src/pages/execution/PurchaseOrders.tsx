import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

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

  const { data: pos = [], isLoading } = useQuery({
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

  const filtered = useMemo(() => {
    if (!search.trim()) return pos;
    const q = search.toLowerCase();
    return pos.filter((p) =>
      (p.po_number || "").toLowerCase().includes(q) ||
      (p.supplier_name || "").toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q)
    );
  }, [pos, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Purchase Orders</h1>
          <p className="text-foreground/60">
            Drafts, sent POs awaiting ASN, and completed receipts.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/decisions/buying">+ Create from recommendations</Link>
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search PO #, supplier or status…" value={search}
          onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{filtered.length} purchase orders</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-6 text-center">Loading…</p>
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
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/execution/purchase-orders/${po.id}`}>Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PurchaseOrders;
