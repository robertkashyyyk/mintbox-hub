import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { SlidersHorizontal, Search, Check, ChevronsUpDown, Save, Wrench } from "lucide-react";
import { toast } from "sonner";

const db = supabase as any;

export type Criteria = {
  brandIds: string[];
  prefixes: string; // comma-separated
  contains: string;
  category: string;
  minCost: string;
  minUnits: string; // min units sold in last 90d
  onlyMissingDims: boolean;
  requireBarcode: boolean;
  notYetSearched: boolean;
  inStockOnly: boolean;
  batchSize: number;
};

const DEFAULTS: Criteria = {
  brandIds: [], prefixes: "", contains: "", category: "", minCost: "", minUnits: "",
  onlyMissingDims: true, requireBarcode: true, notYetSearched: true,
  inStockOnly: false, batchSize: 25,
};

// Apply the criteria to a products_cache query (shared by preview + run).
function applyFilters(qIn: any, c: Criteria) {
  let q = qIn.eq("discontinued", false).eq("quarantined", false);
  if (c.onlyMissingDims) q = q.or("height.is.null,length.is.null,depth.is.null");
  if (c.requireBarcode) q = q.not("barcode", "is", null);
  if (c.notYetSearched) q = q.is("dim_search_checked_at", null);
  if (c.inStockOnly) q = q.gt("current_stock", 0);
  if (c.brandIds.length) q = q.in("brand_id", c.brandIds);
  const prefixes = c.prefixes.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
  if (prefixes.length) q = q.in("prefix", prefixes);
  if (c.contains.trim()) q = q.or(`sku.ilike.%${c.contains.trim()}%,name.ilike.%${c.contains.trim()}%`);
  if (c.minCost.trim() && !isNaN(Number(c.minCost))) q = q.gte("cost_price", Number(c.minCost));
  if (c.minUnits.trim() && !isNaN(Number(c.minUnits))) q = q.gte("units_sold_90d", Number(c.minUnits));
  if (c.category.trim()) q = q.contains("mintsoft_categories", [c.category.trim()]);
  return q;
}

const WebSearchCriteria = ({
  onRun, running,
}: {
  onRun: (skus: string[]) => void;
  running: boolean;
}) => {
  const [c, setC] = useState<Criteria>(DEFAULTS);
  const set = (patch: Partial<Criteria>) => setC((prev) => ({ ...prev, ...patch }));
  const [brandOpen, setBrandOpen] = useState(false);
  const [fetchingRun, setFetchingRun] = useState(false);

  const { data: brands } = useQuery({
    queryKey: ["brands-for-criteria"],
    queryFn: async () => {
      const { data } = await supabase.from("brands").select("id,name").order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  // Live preview count of matching candidates
  const { data: matchCount, isFetching: counting } = useQuery({
    queryKey: ["web-search-criteria-count", c],
    queryFn: async () => {
      const { count } = await applyFilters(
        (supabase as any).from("products_cache").select("sku", { count: "exact", head: true }),
        c,
      );
      return count ?? 0;
    },
  });

  const toggleBrand = (id: string) =>
    set({ brandIds: c.brandIds.includes(id) ? c.brandIds.filter((b) => b !== id) : [...c.brandIds, id] });

  const handleRun = async () => {
    setFetchingRun(true);
    try {
      const { data, error } = await applyFilters(
        (supabase as any).from("products_cache").select("sku"),
        c,
      )
        .order("velocity_per_week", { ascending: false, nullsFirst: false }) // top sellers first
        .order("dim_search_checked_at", { ascending: true, nullsFirst: true })
        .limit(c.batchSize);
      if (error) throw error;
      const skus = (data ?? []).map((r: any) => r.sku);
      if (!skus.length) {
        toast.error("No SKUs match the current criteria");
        return;
      }
      onRun(skus);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not build batch");
    } finally {
      setFetchingRun(false);
    }
  };

  const saveDefault = async () => {
    const { error } = await db.from("web_search_settings").update({
      criteria: {
        brands: c.brandIds,
        prefixes: c.prefixes.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean),
        contains: c.contains,
        category: c.category,
        min_cost: c.minCost ? Number(c.minCost) : null,
        min_units_90d: c.minUnits ? Number(c.minUnits) : null,
        require_barcode: c.requireBarcode,
        only_missing_dims: c.onlyMissingDims,
        in_stock_only: c.inStockOnly,
      },
      batch_size: c.batchSize,
    }).eq("tool", "dims_weights");
    if (error) toast.error(error.message);
    else toast.success("Saved as default criteria (used by scheduled runs)");
  };

  const brandLabel =
    c.brandIds.length === 0 ? "Any brand"
    : c.brandIds.length === 1 ? (brands?.find((b) => b.id === c.brandIds[0])?.name ?? "1 brand")
    : `${c.brandIds.length} brands`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" /> Batch builder — define a challenge
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Brand multi-select */}
          <div>
            <Label className="text-xs">Brand</Label>
            <Popover open={brandOpen} onOpenChange={setBrandOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                  {brandLabel}
                  <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search brands…" />
                  <CommandList>
                    <CommandEmpty>No brands found.</CommandEmpty>
                    <CommandGroup>
                      {(brands ?? []).map((b) => (
                        <CommandItem key={b.id} value={b.name} onSelect={() => toggleBrand(b.id)}>
                          <Check className={`mr-2 h-4 w-4 ${c.brandIds.includes(b.id) ? "opacity-100" : "opacity-0"}`} />
                          {b.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <Label className="text-xs">SKU prefixes (comma-sep)</Label>
            <Input placeholder="e.g. MAH, FEB, NGK" value={c.prefixes}
                   onChange={(e) => set({ prefixes: e.target.value })} />
          </div>

          <div>
            <Label className="text-xs">SKU / name contains</Label>
            <Input placeholder="e.g. filter" value={c.contains}
                   onChange={(e) => set({ contains: e.target.value })} />
          </div>

          <div>
            <Label className="text-xs">Category contains</Label>
            <Input placeholder="e.g. Large Letter" value={c.category}
                   onChange={(e) => set({ category: e.target.value })} />
          </div>

          <div>
            <Label className="text-xs">Min cost price (£)</Label>
            <Input type="number" placeholder="any" value={c.minCost}
                   onChange={(e) => set({ minCost: e.target.value })} />
          </div>

          <div>
            <Label className="text-xs">Min units sold (90d)</Label>
            <Input type="number" placeholder="any" value={c.minUnits}
                   onChange={(e) => set({ minUnits: e.target.value })} />
          </div>

          <div>
            <Label className="text-xs">Batch size</Label>
            <Input type="number" value={c.batchSize}
                   onChange={(e) => set({ batchSize: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap gap-4">
          <Toggle label="Only missing dimensions" checked={c.onlyMissingDims} onChange={(v) => set({ onlyMissingDims: v })} />
          <Toggle label="Must have barcode" checked={c.requireBarcode} onChange={(v) => set({ requireBarcode: v })} />
          <Toggle label="Not yet searched" checked={c.notYetSearched} onChange={(v) => set({ notYetSearched: v })} />
          <Toggle label="In stock only" checked={c.inStockOnly} onChange={(v) => set({ inStockOnly: v })} />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border/50">
          <div className="text-sm">
            <Badge variant="secondary" className="mr-1">
              {counting ? "…" : (matchCount ?? 0).toLocaleString()}
            </Badge>
            SKUs match
          </div>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={saveDefault}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save as default
          </Button>
          <Button size="sm" onClick={handleRun} disabled={running || fetchingRun || !matchCount}>
            {running || fetchingRun
              ? <Wrench className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <Search className="h-3.5 w-3.5 mr-1" />}
            {running || fetchingRun ? "Searching the web…" : `Run batch (${Math.min(c.batchSize, matchCount ?? 0)})`}
          </Button>
        </div>
        <p className="text-[11px] text-foreground/40">
          Runs the Web Searcher on the matched set (up to the batch size, least-recently-searched first).
          Nothing is written to Mintsoft — proposals appear below for review.
        </p>
      </CardContent>
    </Card>
  );
};

const Toggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="flex items-center gap-2 text-sm cursor-pointer">
    <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
    {label}
  </label>
);

export default WebSearchCriteria;
