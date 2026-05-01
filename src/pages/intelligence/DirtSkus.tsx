import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const DirtSkus = () => {
  // Aggregate dirt lines from the last 8 weeks for quick review.
  const { data, isLoading } = useQuery({
    queryKey: ["dirt-skus-recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_line_economics")
        .select("sku, mintsoft_order_id, channel, qty, order_value, profit, order_date, product_name")
        .eq("good_dirt", "Dirt")
        .gte("order_date", new Date(Date.now() - 56 * 86400000).toISOString())
        .order("order_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Group by SKU for the summary table
  const grouped = (() => {
    const map = new Map<string, { sku: string; lines: number; qty: number; revenue: number; profit: number; last_seen: string; product_name?: string | null }>();
    (data ?? []).forEach((row: any) => {
      const k = row.sku ?? "—";
      const e = map.get(k) ?? { sku: k, lines: 0, qty: 0, revenue: 0, profit: 0, last_seen: row.order_date, product_name: row.product_name };
      e.lines += 1;
      e.qty += Number(row.qty ?? 0);
      e.revenue += Number(row.order_value ?? 0);
      e.profit += Number(row.profit ?? 0);
      if (new Date(row.order_date) > new Date(e.last_seen)) e.last_seen = row.order_date;
      map.set(k, e);
    });
    return Array.from(map.values()).sort((a, b) => b.lines - a.lines);
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-warning" />
          Dirt SKUs
        </h1>
        <p className="text-sm text-foreground/60 mt-1">
          SKUs that don't match a known brand prefix style. These slip past brand-routing rules and skew profit/ownership reports.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Last 8 weeks</CardTitle>
          <CardDescription>{isLoading ? "Loading…" : `${grouped.length} unique dirty SKUs across ${data?.length ?? 0} order lines.`}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : grouped.length === 0 ? (
            <div className="text-sm text-foreground/60 py-6 text-center">No dirt SKUs in the last 8 weeks 🎉</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped.map((row) => (
                    <TableRow key={row.sku}>
                      <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                      <TableCell className="text-xs text-foreground/70 max-w-xs truncate">{row.product_name ?? "—"}</TableCell>
                      <TableCell className="text-right">{row.lines}</TableCell>
                      <TableCell className="text-right">{row.qty}</TableCell>
                      <TableCell className="text-right">£{row.revenue.toFixed(0)}</TableCell>
                      <TableCell className={`text-right ${row.profit < 0 ? "text-destructive" : ""}`}>£{row.profit.toFixed(0)}</TableCell>
                      <TableCell className="text-xs text-foreground/70">{new Date(row.last_seen).toLocaleDateString("en-GB")}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] border-warning text-warning">dirt</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-foreground/60">
        Tip: fix these by either (a) adding the missing brand prefix in <Link to="/discovery/brands" className="underline">Brands</Link>, or
        (b) renaming the SKU in Mintsoft to match an existing prefix style.
      </div>
    </div>
  );
};

export default DirtSkus;
