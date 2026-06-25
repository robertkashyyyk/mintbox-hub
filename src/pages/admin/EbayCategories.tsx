/**
 * eBay Category Map — Admin. Maps internal product categories to eBay CategoryIDs
 * so the Opportunities → listing-creation flow can fill the GTC template's
 * CategoryID. Shows which categories still need mapping (in-stock, unlisted SKUs).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Tags, Plus, Trash2, Loader2, Save } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { PageLoader } from "@/components/ui/PageLoader";

interface MapRow { internal_category: string; ebay_category_id: string; ebay_category_name: string | null; updated_at: string }
interface Unmapped { internal_category: string; sku_count: number }

export default function EbayCategories() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ internal_category: "", ebay_category_id: "", ebay_category_name: "" });

  const { data: maps = [], isLoading } = useQuery({
    queryKey: ["ebay-category-map"],
    queryFn: async (): Promise<MapRow[]> => {
      const { data, error } = await (supabase as any).from("ebay_category_map").select("*").order("internal_category");
      if (error) throw error;
      return data as MapRow[];
    },
  });

  const { data: unmapped = [] } = useQuery({
    queryKey: ["ebay-unmapped-categories"],
    queryFn: async (): Promise<Unmapped[]> => {
      const { data, error } = await (supabase as any).rpc("get_unmapped_ebay_categories");
      if (error) throw error;
      return data as Unmapped[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ebay-category-map"] });
    qc.invalidateQueries({ queryKey: ["ebay-unmapped-categories"] });
  };

  const save = useMutation({
    mutationFn: async (row: { internal_category: string; ebay_category_id: string; ebay_category_name: string }) => {
      if (!row.internal_category.trim() || !row.ebay_category_id.trim()) throw new Error("Category and eBay category ID are required");
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("ebay_category_map").upsert({
        internal_category: row.internal_category.trim(),
        ebay_category_id: row.ebay_category_id.trim(),
        ebay_category_name: row.ebay_category_name.trim() || null,
        updated_by: user?.id ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: "internal_category" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mapping saved"); setForm({ internal_category: "", ebay_category_id: "", ebay_category_name: "" }); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (internal_category: string) => {
      const { error } = await (supabase as any).from("ebay_category_map").delete().eq("internal_category", internal_category);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mapping removed"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <ModuleHeader title="eBay Category Map" description="Map internal product categories to eBay category IDs — used to create listings from Opportunities (fills the GTC template's CategoryID)." icon={Tags} />

      {/* Add / edit a mapping */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Add a mapping</CardTitle><CardDescription>Pick (or type) an internal category, then the eBay category number and a description.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label className="text-xs">Internal category</Label><Input list="unmapped-cats" value={form.internal_category} onChange={e => setForm(f => ({ ...f, internal_category: e.target.value }))} placeholder="e.g. Brake Discs" className="w-56 h-9" />
            <datalist id="unmapped-cats">{unmapped.map(u => <option key={u.internal_category} value={u.internal_category}>{u.sku_count} SKUs</option>)}</datalist>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">eBay category ID</Label><Input value={form.ebay_category_id} onChange={e => setForm(f => ({ ...f, ebay_category_id: e.target.value }))} placeholder="e.g. 33555" className="w-32 h-9" /></div>
          <div className="space-y-1.5"><Label className="text-xs">eBay category name</Label><Input value={form.ebay_category_name} onChange={e => setForm(f => ({ ...f, ebay_category_name: e.target.value }))} placeholder="Car Brake Discs & Rotors" className="w-64 h-9" /></div>
          <Button className="h-9" disabled={save.isPending} onClick={() => save.mutate(form)}>{save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}Save</Button>
        </CardContent>
      </Card>

      {/* Categories still needing a mapping */}
      {unmapped.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-3"><CardTitle className="text-base">Needs mapping ({unmapped.length})</CardTitle><CardDescription>Internal categories with in-stock, unlisted SKUs and no eBay mapping yet — mapping these unlocks them for listing.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {unmapped.slice(0, 40).map(u => (
              <button key={u.internal_category} onClick={() => setForm(f => ({ ...f, internal_category: u.internal_category }))}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1 text-xs hover:bg-amber-500/15">
                {u.internal_category}<Badge variant="outline" className="text-[10px]">{u.sku_count}</Badge>
              </button>
            ))}
            {unmapped.length > 40 && <span className="text-xs text-muted-foreground self-center">+ {unmapped.length - 40} more…</span>}
          </CardContent>
        </Card>
      )}

      {/* Existing mappings */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Mappings ({maps.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? <PageLoader rows={6} columns={[200, 120, 220, 60]} label="Loading mappings" /> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Internal category</TableHead><TableHead>eBay ID</TableHead><TableHead>eBay name</TableHead><TableHead className="text-right">Action</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {maps.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No mappings yet.</TableCell></TableRow>}
                {maps.map(m => (
                  <TableRow key={m.internal_category}>
                    <TableCell className="text-sm">{m.internal_category}</TableCell>
                    <TableCell className="font-mono text-xs">{m.ebay_category_id}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.ebay_category_name ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setForm({ internal_category: m.internal_category, ebay_category_id: m.ebay_category_id, ebay_category_name: m.ebay_category_name ?? "" })}><Save className="h-3 w-3 mr-1" />Edit</Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => remove.mutate(m.internal_category)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
