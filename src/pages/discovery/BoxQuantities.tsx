import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PackagePlus, Search, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 100;

const BoxQuantities = () => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [boxedOnly, setBoxedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [edits, setEdits] = useState<Record<string, number>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["box-quantities", search, boxedOnly, page],
    queryFn: async () => {
      const sb = supabase as any;
      let q = sb
        .from("products_cache")
        .select("id, sku, name, box_quantity, brand_id, brands(name)", { count: "exact" })
        .eq("quarantined", false)
        .eq("discontinued", false)
        .order("sku")
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (search.trim()) {
        const s = search.trim();
        q = q.or(`sku.ilike.%${s}%,name.ilike.%${s}%`);
      }
      if (boxedOnly) q = q.gt("box_quantity", 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as any[], count: count || 0 };
    },
  });

  const saveOne = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      const sb = supabase as any;
      const { error } = await sb
        .from("products_cache")
        .update({ box_quantity: Math.max(1, value) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      setEdits((prev) => {
        const { [vars.id]: _drop, ...rest } = prev;
        return rest;
      });
      qc.invalidateQueries({ queryKey: ["box-quantities"] });
      toast({ title: "Box quantity saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const rows = data?.rows || [];
  const total = data?.count || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const dirtyCount = Object.keys(edits).length;

  const saveAll = async () => {
    for (const [id, value] of Object.entries(edits)) {
      await saveOne.mutateAsync({ id, value });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <PackagePlus className="h-7 w-7 text-pd-accent" />
            Box Quantities
          </h1>
          <p className="text-foreground/60">
            Minimum order multiples. Purchase suggestions are rounded up to the nearest box.
          </p>
        </div>
        {dirtyCount > 0 && (
          <Button onClick={saveAll} disabled={saveOne.isPending}>
            {saveOne.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save {dirtyCount} change{dirtyCount === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-4 flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search SKU or name…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="boxed-only" checked={boxedOnly} onCheckedChange={(v) => { setBoxedOnly(v); setPage(0); }} />
            <Label htmlFor="boxed-only" className="cursor-pointer text-sm">Boxed only (&gt; 1)</Label>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {total.toLocaleString()} products
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead className="text-right w-40">Box Quantity</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No products match.</TableCell></TableRow>
                ) : rows.map((r) => {
                  const current = edits[r.id] ?? (r.box_quantity ?? 1);
                  const dirty = edits[r.id] !== undefined && edits[r.id] !== (r.box_quantity ?? 1);
                  return (
                    <TableRow key={r.id} data-state={dirty ? "selected" : undefined}>
                      <TableCell>
                        <Link to={`/discovery/products/${r.sku}`} className="text-primary hover:underline font-mono text-xs">
                          {r.sku}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-md truncate">{r.name || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.brands?.name || "—"}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={1}
                          value={current}
                          onChange={(e) => setEdits({ ...edits, [r.id]: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                          className={`h-8 w-24 ml-auto text-right tabular-nums ${dirty ? "border-pd-accent" : ""} ${current > 1 ? "font-semibold" : ""}`}
                        />
                      </TableCell>
                      <TableCell>
                        {dirty && (
                          <Button size="sm" variant="outline"
                            onClick={() => saveOne.mutate({ id: r.id, value: current })}
                            disabled={saveOne.isPending}>
                            Save
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BoxQuantities;
