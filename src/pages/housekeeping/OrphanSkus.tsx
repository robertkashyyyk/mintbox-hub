import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Link2Off, Play, EyeOff, Search, RotateCw } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

type OrphanRow = {
  id: string;
  sku: string;
  name: string | null;
  brand_id: string | null;
  discovery_source: string | null;
  discovered_at: string | null;
  mintsoft_resolve_attempts: number;
  last_mintsoft_resolve_attempt_at: string | null;
  mintsoft_resolve_ignored: boolean;
  is_true_sku: boolean;
};

const OrphanSkus = () => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<"true_sku" | "all" | "persistent" | "never_tried">("true_sku");
  const [manualSku, setManualSku] = useState("");
  const [linkSku, setLinkSku] = useState("");
  const [linkId, setLinkId] = useState("");

  const { data: counts } = useQuery({
    queryKey: ["orphan-counts"],
    queryFn: async () => {
      const all = await (supabase as any).from("vw_orphan_skus").select("id", { count: "exact", head: true });
      const trueSku = await (supabase as any).from("vw_orphan_skus").select("id", { count: "exact", head: true }).eq("is_true_sku", true);
      const persistent = await (supabase as any).from("vw_orphan_skus").select("id", { count: "exact", head: true }).gte("mintsoft_resolve_attempts", 5);
      const neverTried = await (supabase as any).from("vw_orphan_skus").select("id", { count: "exact", head: true }).is("last_mintsoft_resolve_attempt_at", null);
      return {
        all: all.count ?? 0,
        trueSku: trueSku.count ?? 0,
        persistent: persistent.count ?? 0,
        neverTried: neverTried.count ?? 0,
      };
    },
    refetchInterval: 30000,
  });

  const { data: lastRun } = useQuery({
    queryKey: ["orphan-last-run"],
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_runs")
        .select("*")
        .eq("run_type", "resolve_orphan_skus")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    refetchInterval: 15000,
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["orphan-skus", filter],
    queryFn: async () => {
      let q: any = (supabase as any).from("vw_orphan_skus").select("*").limit(500);
      if (filter === "true_sku") q = q.eq("is_true_sku", true).lt("mintsoft_resolve_attempts", 5);
      if (filter === "persistent") q = q.gte("mintsoft_resolve_attempts", 5);
      if (filter === "never_tried") q = q.is("last_mintsoft_resolve_attempt_at", null).eq("is_true_sku", true);
      q = q.order("last_mintsoft_resolve_attempt_at", { ascending: true, nullsFirst: true });
      const { data, error } = await q;
      if (error) throw error;
      return data as OrphanRow[];
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (skus: string[]) => {
      const { data, error } = await supabase.functions.invoke("mintsoft-resolve-orphan-skus", {
        body: skus.length ? { skus, force: true } : { force: true, batchSize: 200 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast({
        title: "Resolver run complete",
        description: `Checked ${data.checked}: ${data.resolved} linked, ${data.not_found} not found, ${data.errors} errors.`,
      });
      qc.invalidateQueries({ queryKey: ["orphan-skus"] });
      qc.invalidateQueries({ queryKey: ["orphan-counts"] });
      qc.invalidateQueries({ queryKey: ["orphan-last-run"] });
    },
    onError: (e: any) => toast({ title: "Resolver failed", description: e.message, variant: "destructive" }),
  });

  const ignoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products_cache").update({ mintsoft_resolve_ignored: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "SKU ignored" });
      qc.invalidateQueries({ queryKey: ["orphan-skus"] });
      qc.invalidateQueries({ queryKey: ["orphan-counts"] });
    },
  });

  const manualLinkMutation = useMutation({
    mutationFn: async ({ sku, mintsoftId }: { sku: string; mintsoftId: number }) => {
      const { data: row, error: findErr } = await supabase
        .from("products_cache")
        .select("id")
        .eq("sku", sku)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!row) throw new Error(`SKU "${sku}" not found in catalogue`);
      const { error } = await supabase
        .from("products_cache")
        .update({
          mintsoft_product_id: mintsoftId,
          mintsoft_resolved_at: new Date().toISOString(),
          last_mintsoft_resolve_attempt_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Linked", description: "Mintsoft Product ID saved." });
      setLinkSku("");
      setLinkId("");
      qc.invalidateQueries({ queryKey: ["orphan-skus"] });
      qc.invalidateQueries({ queryKey: ["orphan-counts"] });
    },
    onError: (e: any) => toast({ title: "Link failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Orphan SKUs"
        description="Products in our catalogue that aren't linked to a Mintsoft Product ID. The resolver tries to match these against Mintsoft every 6 hours."
        icon={Link2Off}
      />

      {/* Counts strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total orphans", value: counts?.all },
          { label: "True-SKU orphans", value: counts?.trueSku },
          { label: "Never tried", value: counts?.neverTried },
          { label: "Persistent (5+ fails)", value: counts?.persistent },
          {
            label: "Last run",
            value: lastRun?.started_at ? formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true }) : "—",
            small: true,
          },
        ].map((c) => (
          <Card key={c.label} className="bg-card">
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className={c.small ? "text-base font-semibold mt-1" : "text-2xl font-bold mt-1"}>
                {c.value ?? "—"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Manual resolve box */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" />
            Resolve a specific SKU now
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            placeholder="e.g. ASC-TUB-29-PV"
            value={manualSku}
            onChange={(e) => setManualSku(e.target.value.toUpperCase())}
            className="max-w-sm"
          />
          <Button
            onClick={() => resolveMutation.mutate([manualSku.trim()])}
            disabled={!manualSku.trim() || resolveMutation.isPending}
          >
            <Play className="h-4 w-4 mr-2" />
            Resolve
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => resolveMutation.mutate([])} disabled={resolveMutation.isPending}>
            <RotateCw className="h-4 w-4 mr-2" />
            Run resolver batch (200)
          </Button>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          { k: "true_sku" as const, label: "True SKUs (active)" },
          { k: "never_tried" as const, label: "Never tried" },
          { k: "persistent" as const, label: "Persistent failures" },
          { k: "all" as const, label: "All orphans" },
        ].map((f) => (
          <Button
            key={f.k}
            size="sm"
            variant={filter === f.k ? "default" : "outline"}
            onClick={() => setFilter(f.k)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead>Last attempt</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : !rows?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No orphan SKUs match this filter.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    <Link to={`/discovery/products/${r.id}`} className="hover:underline text-pd-accent">{r.sku}</Link>
                    {!r.is_true_sku && <Badge variant="outline" className="ml-2 text-[10px]">not true SKU</Badge>}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{r.name || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.discovery_source || "—"}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className={r.mintsoft_resolve_attempts >= 5 ? "border-destructive/40 text-destructive" : ""}>
                      {r.mintsoft_resolve_attempts}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.last_mintsoft_resolve_attempt_at ? formatDistanceToNow(new Date(r.last_mintsoft_resolve_attempt_at), { addSuffix: true }) : "never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => resolveMutation.mutate([r.sku])} disabled={resolveMutation.isPending}>
                        <Play className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => ignoreMutation.mutate(r.id)} disabled={ignoreMutation.isPending}>
                        <EyeOff className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default OrphanSkus;
