import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageLoader } from "@/components/ui/PageLoader";
import ModuleHeader from "@/components/ModuleHeader";
import { Link2, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface UnmappedRow {
  marketplace_id: string;
  asin: string;
  units: number | null;
  revenue: number | null;
  amazon_sku: string | null;
  title: string | null;
  ean: string | null;
}

const nf = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString());

const AmazonSkuMapping = () => {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isLoading } = useQuery({
    queryKey: ["fba-unmapped"],
    queryFn: async (): Promise<UnmappedRow[]> => {
      const { data, error } = await (supabase as any)
        .from("v_fba_unmapped")
        .select("marketplace_id,asin,units,revenue,amazon_sku,title,ean")
        .order("units", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as UnmappedRow[];
    },
  });

  // SKU suggestions from the catalogue for the datalist
  const { data: suggestions } = useQuery({
    queryKey: ["pc-sku-suggest", debounced],
    enabled: debounced.length >= 2,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("products_cache")
        .select("sku")
        .ilike("sku", `${debounced}%`)
        .eq("discontinued", false)
        .limit(10);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.sku);
    },
  });

  const rows = data ?? [];
  const totals = useMemo(() => ({
    count: rows.length,
    units: rows.reduce((a, r) => a + (r.units ?? 0), 0),
  }), [rows]);

  const save = async (r: UnmappedRow) => {
    const sku = (edits[r.asin] ?? "").trim();
    if (!sku) { toast.error("Enter a catalogue SKU first"); return; }
    setSaving(r.asin);
    try {
      const { error } = await (supabase as any).rpc("amazon_set_manual_map", {
        p_marketplace_id: r.marketplace_id, p_asin: r.asin, p_catalogue_sku: sku,
      });
      if (error) throw error;
      toast.success(`${r.asin} → ${sku}`);
      // drop the row locally + refresh
      qc.setQueryData<UnmappedRow[]>(["fba-unmapped"], (prev) => (prev ?? []).filter((x) => x.asin !== r.asin));
    } catch (e: any) {
      toast.error(`Failed: ${e.message ?? e}`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Amazon SKUs to map"
        description="Amazon ASINs that sold recently but don't resolve to a catalogue SKU (mostly own-brand with no usable barcode). Pick the right SKU to pin the mapping — the nightly rebuild won't overwrite it."
        icon={Link2}
      />

      <div className="grid grid-cols-2 gap-4">
        <Card><CardHeader className="pb-2"><CardDescription>ASINs to map</CardDescription>
          <CardTitle className="text-3xl">{nf(totals.count)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Units (8 weeks) waiting</CardDescription>
          <CardTitle className="text-3xl">{nf(totals.units)}</CardTitle></CardHeader></Card>
      </div>

      <datalist id="sku-suggestions">
        {(suggestions ?? []).map((s) => <option key={s} value={s} />)}
      </datalist>

      <Card>
        <CardHeader>
          <CardTitle>Unmapped ASINs</CardTitle>
          <CardDescription>Highest-selling first — map these to recover them on the FBA Replenishment list.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <PageLoader rows={10} columns={[130, 160, 240, 70, 200]} label="Loading unmapped ASINs" />
          ) : rows.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">🎉 Nothing to map — every selling ASIN resolves to a catalogue SKU.</div>
          ) : (
            <div className="rounded-md border [&>div]:max-h-[70vh] [&>div]:overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead>ASIN</TableHead>
                    <TableHead>Amazon SKU</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right">Units 8wk</TableHead>
                    <TableHead className="w-[260px]">Catalogue SKU</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.asin}>
                      <TableCell className="font-mono text-xs">
                        <a href={`https://www.amazon.co.uk/dp/${r.asin}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{r.asin}</a>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate" title={r.amazon_sku ?? ""}>{r.amazon_sku ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[260px] truncate" title={r.title ?? ""}>{r.title ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium">{nf(r.units)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input
                            list="sku-suggestions"
                            placeholder="catalogue SKU…"
                            className="h-8"
                            value={edits[r.asin] ?? ""}
                            onChange={(e) => { setEdits((p) => ({ ...p, [r.asin]: e.target.value })); setQuery(e.target.value); }}
                            onKeyDown={(e) => { if (e.key === "Enter") save(r); }}
                          />
                          <Button size="sm" className="h-8" onClick={() => save(r)} disabled={saving === r.asin || !(edits[r.asin] ?? "").trim()}>
                            {saving === r.asin ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
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
    </div>
  );
};

export default AmazonSkuMapping;
