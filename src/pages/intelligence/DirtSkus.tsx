import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { Link } from "react-router-dom";

type RangeKey = "1" | "2" | "4" | "8";
const RANGE_LABEL: Record<RangeKey, string> = {
  "1": "Last week",
  "2": "Last 2 weeks",
  "4": "Last 4 weeks",
  "8": "Last 8 weeks",
};

type SortKey = "sku" | "product_name" | "lines" | "qty" | "revenue" | "profit" | "last_seen";

const DirtSkus = () => {
  const [range, setRange] = useState<RangeKey>("8");
  const [search, setSearch] = useState("");
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("lines");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const days = Number(range) * 7;

  const { data, isLoading } = useQuery({
    queryKey: ["dirt-skus-recent", days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_line_economics")
        .select("sku, mintsoft_order_id, channel, qty, order_value, profit, order_date, product_name")
        .eq("good_dirt", "Dirt")
        .gte("order_date", new Date(Date.now() - days * 86400000).toISOString())
        .order("order_date", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const grouped = useMemo(() => {
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
    return Array.from(map.values());
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = grouped.filter((r) => !resolved.has(r.sku));
    if (q) {
      rows = rows.filter(
        (r) => r.sku.toLowerCase().includes(q) || (r.product_name ?? "").toLowerCase().includes(q),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a: any, b: any) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === "last_seen") return (new Date(av).getTime() - new Date(bv).getTime()) * dir;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
    return rows;
  }, [grouped, resolved, search, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "sku" || k === "product_name" ? "asc" : "desc");
    }
  };

  const SortHead = ({ k, children, numeric }: { k: SortKey; children: React.ReactNode; numeric?: boolean }) => (
    <TableHead numeric={numeric}>
      <button
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${numeric ? "justify-end w-full" : ""}`}
      >
        {children}
        {sortKey === k ? (
          sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );

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
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <CardTitle className="text-base">{RANGE_LABEL[range]}</CardTitle>
              <CardDescription>
                {isLoading
                  ? "Loading…"
                  : `${filtered.length} shown · ${grouped.length} unique · ${data?.length ?? 0} order lines${resolved.size ? ` · ${resolved.size} resolved` : ""}`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search SKU or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-56"
              />
              <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
                    <SelectItem key={k} value={k}>{RANGE_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {resolved.size > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setResolved(new Set())}>
                  Clear resolved ({resolved.size})
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-foreground/60 py-6 text-center">
              {grouped.length === 0 ? "No dirt SKUs in this period 🎉" : "Nothing matches the current filter."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead k="sku">SKU</SortHead>
                    <SortHead k="product_name">Name</SortHead>
                    <SortHead k="lines" numeric>Lines</SortHead>
                    <SortHead k="qty" numeric>Qty</SortHead>
                    <SortHead k="revenue" numeric>Revenue</SortHead>
                    <SortHead k="profit" numeric>Profit</SortHead>
                    <SortHead k="last_seen">Last seen</SortHead>
                    <TableHead></TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.sku}>
                      <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                      <TableCell className="text-xs text-foreground/70 max-w-xs truncate">{row.product_name ?? "—"}</TableCell>
                      <TableCell numeric>{row.lines}</TableCell>
                      <TableCell numeric>{row.qty}</TableCell>
                      <TableCell numeric>£{row.revenue.toFixed(0)}</TableCell>
                      <TableCell numeric className={row.profit < 0 ? "text-destructive" : ""}>£{row.profit.toFixed(0)}</TableCell>
                      <TableCell className="text-xs text-foreground/70">{new Date(row.last_seen).toLocaleDateString("en-GB")}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] border-warning text-warning">dirt</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setResolved((prev) => new Set(prev).add(row.sku))}
                        >
                          <X className="h-3 w-3 mr-1" /> Resolve
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

      <div className="text-xs text-foreground/60">
        Tip: fix these by either (a) adding the missing brand prefix in <Link to="/discovery/brands" className="underline">Brands</Link>, or
        (b) renaming the SKU in Mintsoft to match an existing prefix style. "Resolve" only hides the row from this view until refresh.
      </div>
    </div>
  );
};

export default DirtSkus;
