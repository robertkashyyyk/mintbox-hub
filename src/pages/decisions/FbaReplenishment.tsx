import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/ui/PageLoader";
import ModuleHeader from "@/components/ModuleHeader";
import { ArrowUpDown, Truck, Download, AlertTriangle } from "lucide-react";

interface Row {
  marketplace_id: string;
  country_code: string | null;
  base_sku: string;
  weekly_velocity: number | null;
  units_7d: number | null;
  units_30d: number | null;
  fba_on_hand: number | null;
  fba_in_transit: number | null;
  target_units: number | null;
  days_of_cover_weeks: number | null;
  units_to_order: number | null;
  replenish_flag: boolean | null;
}

type SortField = keyof Row;

const csvCell = (s: unknown) => {
  const v = s == null ? "" : String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const nf = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

const FbaReplenishment = () => {
  const [search, setSearch] = useState("");
  const [reorderOnly, setReorderOnly] = useState(true);
  const [country, setCountry] = useState<string>("all");
  const [sort, setSort] = useState<{ field: SortField; dir: "asc" | "desc" }>({ field: "units_to_order", dir: "desc" });

  const { data, isLoading } = useQuery({
    queryKey: ["fba-replenishment"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("v_fba_replenishment")
        .select("marketplace_id,country_code,base_sku,weekly_velocity,units_7d,units_30d,fba_on_hand,fba_in_transit,target_units,days_of_cover_weeks,units_to_order,replenish_flag")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = data ?? [];
  const countries = useMemo(
    () => Array.from(new Set(rows.map((r) => r.country_code).filter(Boolean))).sort() as string[],
    [rows],
  );

  const filtered = useMemo(() => {
    let out = rows;
    if (reorderOnly) out = out.filter((r) => r.replenish_flag);
    if (country !== "all") out = out.filter((r) => r.country_code === country);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => r.base_sku?.toLowerCase().includes(q));
    }
    const { field, dir } = sort;
    return [...out].sort((a, b) => {
      const av = a[field], bv = b[field];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return dir === "asc" ? av - bv : bv - av;
      return dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [rows, reorderOnly, country, search, sort]);

  const totals = useMemo(() => {
    const flagged = rows.filter((r) => r.replenish_flag);
    return {
      flaggedSkus: flagged.length,
      unitsToOrder: flagged.reduce((a, r) => a + (r.units_to_order ?? 0), 0),
      stockedOut: flagged.filter((r) => (r.fba_on_hand ?? 0) === 0 && (r.fba_in_transit ?? 0) === 0).length,
    };
  }, [rows]);

  const toggleSort = (field: SortField) =>
    setSort((p) => ({ field, dir: p.field === field && p.dir === "desc" ? "asc" : "desc" }));

  const exportCsv = () => {
    const header = ["SKU", "Country", "Weekly velocity", "Units 30d", "FBA on-hand", "In-transit", "Weeks cover", "Target units", "Units to order", "Reorder"];
    const lines = [header, ...filtered.map((r) => [
      r.base_sku, r.country_code ?? "", r.weekly_velocity ?? 0, r.units_30d ?? 0, r.fba_on_hand ?? 0,
      r.fba_in_transit ?? 0, r.days_of_cover_weeks ?? "", r.target_units ?? 0, r.units_to_order ?? 0,
      r.replenish_flag ? "YES" : "no",
    ])];
    const csv = lines.map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = `fba-replenishment-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const SortHead = ({ field, label, className }: { field: SortField; label: string; className?: string }) => (
    <TableHead className={className}>
      <Button variant="ghost" size="sm" onClick={() => toggleSort(field)} className="h-8 px-2 -ml-2">
        {label}<ArrowUpDown className="ml-1.5 h-3.5 w-3.5" />
      </Button>
    </TableHead>
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="FBA Replenishment"
        description="What to ship into Amazon FBA — demand (Sales & Traffic) vs current FBA stock. Target cover, less on-hand and in-transit, MOQ-rounded. Single-unit (Q-code) normalised."
        icon={Truck}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardDescription>SKUs to reorder</CardDescription>
          <CardTitle className="text-3xl">{nf(totals.flaggedSkus)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Total units to send</CardDescription>
          <CardTitle className="text-3xl">{nf(totals.unitsToOrder)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription className="flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />Stocked-out movers</CardDescription>
          <CardTitle className="text-3xl">{nf(totals.stockedOut)}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Reorder list</CardTitle>
            <CardDescription>Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} SKUs</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4 mr-1" />Export CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <Input placeholder="Search SKU…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            {countries.length > 1 && (
              <select value={country} onChange={(e) => setCountry(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All countries</option>
                {countries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <div className="flex items-center gap-2">
              <Switch id="reorder-only" checked={reorderOnly} onCheckedChange={setReorderOnly} />
              <Label htmlFor="reorder-only" className="text-sm">Reorder needed only</Label>
            </div>
          </div>

          {isLoading ? (
            <PageLoader rows={12} columns={[180, 80, 90, 90, 90, 90, 90, 90]} label="Loading replenishment" />
          ) : (
            <div className="rounded-md border [&>div]:max-h-[70vh] [&>div]:overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <SortHead field="base_sku" label="SKU" />
                    <SortHead field="weekly_velocity" label="Velocity/wk" className="text-right" />
                    <SortHead field="units_30d" label="Units 30d" className="text-right" />
                    <SortHead field="fba_on_hand" label="On-hand" className="text-right" />
                    <SortHead field="fba_in_transit" label="In-transit" className="text-right" />
                    <SortHead field="days_of_cover_weeks" label="Weeks cover" className="text-right" />
                    <SortHead field="target_units" label="Target" className="text-right" />
                    <SortHead field="units_to_order" label="To order" className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No SKUs match</TableCell></TableRow>
                  ) : filtered.map((r) => {
                    const out = (r.fba_on_hand ?? 0) === 0 && (r.fba_in_transit ?? 0) === 0;
                    return (
                      <TableRow key={`${r.marketplace_id}-${r.base_sku}`}>
                        <TableCell className="font-medium">
                          {r.base_sku}
                          {r.country_code && <Badge variant="outline" className="ml-2 text-[10px]">{r.country_code}</Badge>}
                        </TableCell>
                        <TableCell className="text-right font-medium">{nf(r.weekly_velocity, 1)}</TableCell>
                        <TableCell className="text-right">{nf(r.units_30d)}</TableCell>
                        <TableCell className="text-right">
                          {out ? <Badge variant="destructive">0</Badge> : nf(r.fba_on_hand)}
                        </TableCell>
                        <TableCell className="text-right">{nf(r.fba_in_transit)}</TableCell>
                        <TableCell className="text-right">{nf(r.days_of_cover_weeks, 1)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{nf(r.target_units, 0)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{nf(r.units_to_order)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FbaReplenishment;
