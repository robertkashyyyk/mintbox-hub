import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Loader2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

interface Store {
  id: string;
  store_name: string;
  mintsoft_channel: string;
  sftp_filename: string;
  enabled: boolean;
}
interface Candidate {
  sku: string;
  product_name: string | null;
  brand_name: string | null;
  units_sold: number;
  revenue: number | null;
  profit: number | null;
  por_pct: number | null;
  current_price: number | null;
  current_stock: number | null;
}
interface PushLog {
  id: string;
  pushed_at: string;
  row_count: number;
  status: string;
  sftp_path: string | null;
  error_message: string | null;
}

const gbp = (n: number | null | undefined) =>
  n == null ? "—" :
    new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toFixed(1)}%`;

/**
 * Suggested new price = break-even + 5% headroom.
 * profit_per_unit = profit / units. If profit < 0 we add the loss back
 * onto the current price so the SKU at least breaks even, plus a small
 * cushion. Only returned when we have current_price, units > 0 and a
 * negative profit — otherwise the user can keep the current price.
 */
const suggestPrice = (c: Candidate): number | null => {
  if (c.current_price == null || c.units_sold <= 0 || c.profit == null) return null;
  if (c.profit >= 0) return null;
  const lossPerUnit = -c.profit / c.units_sold; // positive
  const suggested = c.current_price + lossPerUnit;
  // 5% cushion so we don't sit exactly on break-even
  return Math.round(suggested * 1.05 * 100) / 100;
};

export default function ThreedsReprice() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [storeId, setStoreId] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [search, setSearch] = useState("");
  const [lossOnly, setLossOnly] = useState(false);
  const [selected, setSelected] = useState<Record<string, { checked: boolean; price: string }>>({});

  const { data: stores, isLoading: storesLoading } = useQuery({
    queryKey: ["threeds_stores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threeds_stores")
        .select("*")
        .order("store_name");
      if (error) throw error;
      return data as Store[];
    },
  });

  const activeStore = stores?.find((s) => s.id === storeId) ?? null;

  const { data: candidates, isLoading: candLoading, refetch } = useQuery({
    queryKey: ["threeds_candidates", activeStore?.mintsoft_channel, days],
    enabled: !!activeStore,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_threeds_reprice_candidates", {
        p_channel: activeStore!.mintsoft_channel,
        p_days: days,
      });
      if (error) throw error;
      return (data ?? []) as Candidate[];
    },
  });

  const { data: pushes } = useQuery({
    queryKey: ["threeds_pushes", storeId],
    enabled: !!storeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threeds_reprice_pushes")
        .select("id, pushed_at, row_count, status, sftp_path, error_message")
        .eq("store_id", storeId!)
        .order("pushed_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as PushLog[];
    },
  });

  const filtered = useMemo(() => {
    let rows = candidates ?? [];
    if (lossOnly) rows = rows.filter((r) => (r.profit ?? 0) < 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.sku.toLowerCase().includes(q) ||
          (r.product_name ?? "").toLowerCase().includes(q) ||
          (r.brand_name ?? "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [candidates, lossOnly, search]);

  const selectedRows = useMemo(() => {
    return Object.entries(selected)
      .filter(([_, v]) => v.checked && v.price.trim() !== "")
      .map(([sku, v]) => ({ sku, new_price: parseFloat(v.price) }))
      .filter((r) => !isNaN(r.new_price) && r.new_price >= 0);
  }, [selected]);

  const pushMutation = useMutation({
    mutationFn: async () => {
      if (!storeId) throw new Error("No store selected");
      if (selectedRows.length === 0) throw new Error("Tick rows and enter prices first");
      const { data, error } = await supabase.functions.invoke("threeds-reprice-push", {
        body: { store_id: storeId, rows: selectedRows },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Pushed to 3D",
        description: `${data.row_count} rows uploaded to ${data.sftp_path}`,
      });
      setSelected({});
      qc.invalidateQueries({ queryKey: ["threeds_pushes", storeId] });
    },
    onError: (e: Error) => {
      toast({ title: "Push failed", description: e.message, variant: "destructive" });
    },
  });

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected({});
      return;
    }
    const next: typeof selected = {};
    for (const r of filtered) {
      next[r.sku] = {
        checked: true,
        price: selected[r.sku]?.price || (r.current_price?.toFixed(2) ?? ""),
      };
    }
    setSelected(next);
  };

  const allChecked = filtered.length > 0 && filtered.every((r) => selected[r.sku]?.checked);

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="text-pd-accent hover:text-pd-accent-light mb-2"
          onClick={() => navigate("/decisions")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Decisions
        </Button>
        <h1 className="text-2xl font-bold text-foreground">3D Reprice</h1>
        <p className="text-sm text-foreground/60">
          Pick a store, tick the SKUs you want to reprice, type the new price, then push to 3D via SFTP.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Store & window</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Store (channel)</label>
            <Select value={storeId ?? ""} onValueChange={setStoreId}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder={storesLoading ? "Loading…" : "Pick a store"} />
              </SelectTrigger>
              <SelectContent>
                {stores?.map((s) => (
                  <SelectItem key={s.id} value={s.id} disabled={!s.enabled}>
                    {s.store_name} <span className="text-muted-foreground">— {s.mintsoft_channel}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Look-back</label>
            <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
                <SelectItem value="180">180 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Search SKU / brand / name</label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. NGK-05747" />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox id="lossOnly" checked={lossOnly} onCheckedChange={(v) => setLossOnly(!!v)} />
            <label htmlFor="lossOnly" className="text-sm">Loss-makers only</label>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={!activeStore}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      {activeStore && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {filtered.length} SKUs · {selectedRows.length} selected
            </CardTitle>
            <Button
              onClick={() => pushMutation.mutate()}
              disabled={pushMutation.isPending || selectedRows.length === 0}
            >
              {pushMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Pushing…</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" /> Push {selectedRows.length} to 3D</>
              )}
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {candLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No SKUs sold on this channel in the selected window.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allChecked}
                        onCheckedChange={(v) => toggleAll(!!v)}
                      />
                    </TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">PoR%</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Last Sold £</TableHead>
                    <TableHead className="text-right w-[120px]">New Price £</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const sel = selected[r.sku];
                    const negative = (r.profit ?? 0) < 0;
                    return (
                      <TableRow key={r.sku} className={negative ? "bg-destructive/5" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={!!sel?.checked}
                            onCheckedChange={(v) =>
                              setSelected((p) => ({
                                ...p,
                                [r.sku]: {
                                  checked: !!v,
                                  price: p[r.sku]?.price || (r.current_price?.toFixed(2) ?? ""),
                                },
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                        <TableCell>{r.brand_name ?? "—"}</TableCell>
                        <TableCell className="text-right">{r.units_sold}</TableCell>
                        <TableCell className="text-right">{gbp(r.revenue)}</TableCell>
                        <TableCell className={`text-right font-medium ${negative ? "text-destructive" : ""}`}>
                          {gbp(r.profit)}
                        </TableCell>
                        <TableCell className="text-right">{pct(r.por_pct)}</TableCell>
                        <TableCell className="text-right">{r.current_stock ?? "—"}</TableCell>
                        <TableCell className="text-right">{gbp(r.current_price)}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            className="h-8 w-24 text-right ml-auto"
                            value={sel?.price ?? ""}
                            onChange={(e) =>
                              setSelected((p) => ({
                                ...p,
                                [r.sku]: {
                                  checked: p[r.sku]?.checked ?? false,
                                  price: e.target.value,
                                },
                              }))
                            }
                            placeholder={r.current_price?.toFixed(2) ?? ""}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {activeStore && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent pushes</CardTitle>
          </CardHeader>
          <CardContent>
            {!pushes || pushes.length === 0 ? (
              <div className="text-sm text-muted-foreground">No pushes yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>SFTP path</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pushes.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{format(new Date(p.pushed_at), "PPp")}</TableCell>
                      <TableCell>{p.row_count}</TableCell>
                      <TableCell className="font-mono text-xs">{p.sftp_path}</TableCell>
                      <TableCell>
                        {p.status === "success" ? (
                          <Badge>success</Badge>
                        ) : p.status === "error" ? (
                          <Badge variant="destructive">
                            <AlertTriangle className="h-3 w-3 mr-1" />error
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{p.status}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-destructive max-w-md truncate">
                        {p.error_message ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
