import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, DollarSign, LineChart, X } from "lucide-react";
import { useStockValuation, type CategoryAgg } from "@/hooks/useStockValuation";
import { supabase } from "@/integrations/supabase/client";

const HEALTH_CATEGORIES = [
  "Extreme Overstock", "Overstock", "Unhealthy", "Healthy",
  "Low Stock", "Critical", "Dead Stock", "Out of Stock",
  "Non Selling", "Missing Baseline", "Unknown",
];

const healthBadge = (cat: string) => {
  const map: Record<string, string> = {
    "Extreme Overstock": "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300",
    "Overstock": "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300",
    "Unhealthy": "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300",
    "Healthy": "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300",
    "Low Stock": "bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300",
    "Critical": "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300",
    "Out of Stock": "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300",
    "Dead Stock": "bg-muted text-foreground/70",
    "Non Selling": "bg-muted text-foreground/70",
    "Missing Baseline": "bg-background border-2 border-warning text-warning",
  };
  return map[cat] || "bg-muted text-muted-foreground";
};

const gbp = (v: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v || 0);
const gbpFull = (v: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }).format(v || 0);
const num = (v: number) => new Intl.NumberFormat("en-GB").format(Math.round(v || 0));

const TILE_GROUPS: Array<{ label: string; tone: string; cats: string[] }> = [
  { label: "Healthy",     tone: "border-green-600/40 bg-green-500/10",  cats: ["Healthy"] },
  { label: "Low / Critical / OOS", tone: "border-destructive/40 bg-destructive/10", cats: ["Low Stock","Critical","Out of Stock"] },
  { label: "Overstock",   tone: "border-blue-500/40 bg-blue-500/10",    cats: ["Overstock","Extreme Overstock"] },
  { label: "Unhealthy",   tone: "border-yellow-500/40 bg-yellow-500/10",cats: ["Unhealthy"] },
  { label: "Dead Stock",    tone: "border-border bg-muted/30",         cats: ["Dead Stock"] },
  { label: "Non Selling",   tone: "border-teal-500/40 bg-teal-500/10", cats: ["Non Selling"] },
  { label: "Missing Baseline / Unknown", tone: "border-warning/40 bg-warning/10", cats: ["Missing Baseline","Unknown"] },
];

const sumGroup = (byCat: Record<string, CategoryAgg>, cats: string[]): CategoryAgg =>
  cats.reduce(
    (a, c) => ({
      skus: a.skus + (byCat[c]?.skus ?? 0),
      units: a.units + Number(byCat[c]?.units ?? 0),
      value: a.value + Number(byCat[c]?.value ?? 0),
    }),
    { skus: 0, units: 0, value: 0 }
  );

const StockValuation = () => {
  const {
    data, loading, totalCount, summary, page, pageSize, setPage,
    filters, handleFiltersChange, sortBy, sortOrder, handleSort,
  } = useStockValuation();

  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    supabase.from("brands").select("id, name").order("name").then(({ data }) => setBrands(data ?? []));
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const SortHead = ({ col, label, numeric }: { col: string; label: string; numeric?: boolean }) => (
    <TableHead numeric={numeric} className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort(col)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy === col && <span className="text-xs">{sortOrder === "asc" ? "↑" : "↓"}</span>}
      </span>
    </TableHead>
  );

  const activeFilterCount = [
    filters.search,
    filters.brandId !== "all" ? "b" : "",
    filters.healthCategory !== "all" ? "h" : "",
    filters.onlyMissingCost,
    !filters.onlyInStock,
    filters.excludeDirt,
  ].filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Stock Valuation</h1>
        <Button variant="outline" size="sm" asChild>
          <Link to="/intelligence/stock-valuation/graphs">
            <LineChart className="h-4 w-4 mr-2" />Graphs
          </Link>
        </Button>
      </div>

      {/* Top totals */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-md border-2 border-pd-accent/40 bg-pd-accent/10 p-4">
            <div className="text-xs uppercase tracking-wide text-foreground/60">Total stock value</div>
            <div className="text-3xl font-bold mt-1 text-foreground">{gbp(summary.totalValue)}</div>
            <div className="text-xs mt-1 text-foreground/70">at cost price</div>
          </div>
          <div className="rounded-md border-2 border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-foreground/60">Total units on hand</div>
            <div className="text-3xl font-bold mt-1 text-foreground">{num(summary.totalUnits)}</div>
            <div className="text-xs mt-1 text-foreground/70">{num(summary.totalSkus)} SKUs in scope</div>
          </div>
          <div className="rounded-md border-2 border-warning/40 bg-warning/10 p-4">
            <div className="text-xs uppercase tracking-wide text-foreground/60">Missing cost (in stock)</div>
            <div className="text-3xl font-bold mt-1 text-foreground">{num(summary.missingCostSkus)}</div>
            <div className="text-xs mt-1 text-foreground/70">{num(summary.missingCostUnits)} units uncosted</div>
          </div>
          <div className="rounded-md border-2 border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-foreground/60">Avg value / SKU</div>
            <div className="text-3xl font-bold mt-1 text-foreground">
              {summary.totalSkus ? gbpFull(summary.totalValue / summary.totalSkus) : "£0.00"}
            </div>
            <div className="text-xs mt-1 text-foreground/70">across in-scope SKUs</div>
          </div>
        </div>
      )}

      {/* By health-category breakdown */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TILE_GROUPS.map((g) => {
            const agg = sumGroup(summary.byCategory, g.cats);
            const isActive = g.cats.length === 1 && filters.healthCategory === g.cats[0];
            return (
              <button
                key={g.label}
                type="button"
                onClick={() => {
                  // If single-category tile, toggle category filter; multi-category just clears
                  if (g.cats.length === 1) {
                    handleFiltersChange({
                      healthCategory: filters.healthCategory === g.cats[0] ? "all" : g.cats[0],
                    });
                  } else {
                    handleFiltersChange({ healthCategory: "all" });
                  }
                }}
                className={`text-left rounded-md border-2 p-4 transition hover:brightness-125 focus:outline-none focus:ring-2 focus:ring-pd-accent ${g.tone} ${isActive ? "ring-2 ring-pd-accent" : ""}`}
              >
                <div className="text-xs uppercase tracking-wide text-foreground/60">{g.label}</div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-[10px] uppercase text-foreground/50">SKUs</div>
                    <div className="text-lg font-bold text-foreground">{num(agg.skus)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-foreground/50">Units</div>
                    <div className="text-lg font-bold text-foreground">{num(agg.units)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-foreground/50">Value</div>
                    <div className="text-lg font-bold text-foreground">{gbp(agg.value)}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-pd-accent" />
            <CardTitle>SKU valuations</CardTitle>
          </div>
          <CardDescription>
            {loading ? "Loading…" : `Showing ${data.length} of ${num(totalCount)} SKUs`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Filters</h3>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => handleFiltersChange({
                  search: "", brandId: "all", healthCategory: "all",
                  onlyMissingCost: false, onlyInStock: true, excludeDirt: false,
                })}>
                  <X className="h-4 w-4 mr-1" />Clear ({activeFilterCount})
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Search SKU</label>
                <Input placeholder="Enter SKU…" value={filters.search}
                  onChange={(e) => handleFiltersChange({ search: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Brand</label>
                <Select value={filters.brandId} onValueChange={(v) => handleFiltersChange({ brandId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Brands</SelectItem>
                    {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Health Category</label>
                <Select value={filters.healthCategory} onValueChange={(v) => handleFiltersChange({ healthCategory: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {HEALTH_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <div className="flex items-center space-x-2">
                <Switch id="in-stock" checked={filters.onlyInStock}
                  onCheckedChange={(v) => handleFiltersChange({ onlyInStock: v })} />
                <Label htmlFor="in-stock" className="text-sm cursor-pointer">In-stock only</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="missing-cost" checked={filters.onlyMissingCost}
                  onCheckedChange={(v) => handleFiltersChange({ onlyMissingCost: v })} />
                <Label htmlFor="missing-cost" className="text-sm cursor-pointer">Only missing cost</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="excl-dirt" checked={filters.excludeDirt}
                  onCheckedChange={(v) => handleFiltersChange({ excludeDirt: v })} />
                <Label htmlFor="excl-dirt" className="text-sm cursor-pointer">Exclude DIRT</Label>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading…</div>
          ) : data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No SKUs match the current filters.</div>
          ) : (
            <>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortHead col="sku" label="SKU" />
                      <SortHead col="brand_name" label="Brand" />
                      <SortHead col="current_stock" label="Stock" numeric />
                      <SortHead col="cost_price" label="Unit cost" numeric />
                      <SortHead col="net_value" label="Net value" numeric />
                      <SortHead col="health_category" label="Health" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((r) => {
                      const missing = r.cost_price == null || Number(r.cost_price) === 0;
                      return (
                        <TableRow key={r.sku}>
                          <TableCell>
                            <Link to={`/discovery/products/${r.sku}`} className="text-primary hover:underline font-medium">
                              {r.sku}
                            </Link>
                          </TableCell>
                          <TableCell>{r.brand_name ?? "—"}</TableCell>
                          <TableCell numeric>{num(Number(r.current_stock))}</TableCell>
                          <TableCell numeric>
                            {missing ? (
                              <span className="inline-block rounded px-2 py-0.5 bg-warning/20 text-warning font-semibold">
                                £0.00
                              </span>
                            ) : (
                              gbpFull(Number(r.cost_price))
                            )}
                          </TableCell>
                          <TableCell numeric className={missing ? "text-warning" : ""}>
                            {gbpFull(Number(r.net_value))}
                          </TableCell>
                          <TableCell>
                            <Badge className={healthBadge(r.health_category)}>{r.health_category}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Page {page} of {num(totalPages)}</div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page === 1}>
                      <ChevronLeft className="h-4 w-4" />Previous
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
                      Next<ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StockValuation;
