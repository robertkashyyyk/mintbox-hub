import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Bot, Info, Upload, Loader2 } from "lucide-react";
import { type Tier, TIER_OPTIONS, TIER_TARGET_POR_PCT, classifyPorBand } from "@/lib/reprice";

// Amazon reprices via eSagu. This panel is a live worklist AND an action surface:
// pick items that are too low / in the wrong band, choose a target tier, and push the
// target as an eSagu FLOOR (min). eSagu then optimises up from there — we're setting
// bounds, not fighting the engine (that's why it's safe, unlike a direct price push).

const fmtGBP = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(n));

type StatusKey = "below_floor" | "stuck_fba" | "losing_box" | "margin_headroom";

const STATUS_META: Record<StatusKey, { label: string; cls: string }> = {
  below_floor:     { label: "below cost floor", cls: "border-destructive/60 bg-destructive/15 text-destructive" },
  stuck_fba:       { label: "stuck in FBA",      cls: "border-orange-500/60 bg-orange-500/15 text-orange-400" },
  losing_box:      { label: "losing buy box",    cls: "border-warning/60 bg-warning/20 text-warning" },
  margin_headroom: { label: "margin headroom",   cls: "border-pd-accent/50 bg-pd-accent/10 text-pd-accent" },
};

export default function AmazonReprice() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | StatusKey>("all");
  const [tier, setTier] = useState<Tier>("average");
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  const targetPorFrac = TIER_TARGET_POR_PCT[tier] / 100;

  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ["amazon-reprice-summary"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_amazon_reprice_summary");
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
  });

  const { data: rows, isLoading: rowsLoading } = useQuery({
    queryKey: ["amazon-reprice-overview", tier],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_amazon_reprice_overview", { p_limit: 400, p_target_por: targetPorFrac });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => statusFilter === "all" || r.status === statusFilter),
    [rows, statusFilter],
  );
  const selectedRows = useMemo(
    () => filtered.filter((r) => selected[r.esagu_item_id] && r.target_price != null),
    [filtered, selected],
  );
  const sellable = filtered.filter((r) => r.target_price != null);
  const allChecked = sellable.length > 0 && sellable.every((r) => selected[r.esagu_item_id]);

  const holdPct = summary && summary.total ? Math.round((100 * summary.we_hold_box) / summary.total) : null;

  const pushMut = useMutation({
    mutationFn: async () => {
      const items = selectedRows.map((r) => ({ itemId: r.esagu_item_id, floor: r.target_price }));
      const { data, error } = await supabase.functions.invoke("esagu-set-floor", { body: { items, live: true } });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (d) => {
      toast({ title: "Pushed to eSagu", description: `${d?.succeeded ?? 0} of ${selectedRows.length} floors set to the ${tier} tier.` });
      setSelected({});
      qc.invalidateQueries({ queryKey: ["amazon-reprice-overview"] });
      qc.invalidateQueries({ queryKey: ["amazon-reprice-summary"] });
    },
    onError: (e) => toast({ title: "Push failed", description: String(e), variant: "destructive" }),
  });

  const toggleFilter = (k: StatusKey) => { setStatusFilter((cur) => (cur === k ? "all" : k)); setSelected({}); };

  // Clickable summary card. A statusKey makes it a filter toggle.
  const chip = (label: string, value: string | number, sub: string, tone: string, statusKey?: StatusKey) => (
    <button
      type="button"
      onClick={statusKey ? () => toggleFilter(statusKey) : undefined}
      className={`text-left rounded-lg border px-3 py-2 transition ${tone} ${statusKey ? "cursor-pointer hover:brightness-125" : "cursor-default"} ${statusKey && statusFilter === statusKey ? "ring-2 ring-offset-1 ring-offset-background ring-current" : ""}`}
    >
      <div className="text-lg font-semibold leading-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-[10px] text-muted-foreground/70">{sub}</div>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-pd-accent/30 bg-pd-accent/5 px-3 py-2 text-xs text-foreground/80 flex items-start gap-2">
        <Bot className="h-4 w-4 flex-shrink-0 mt-0.5 text-pd-accent" />
        <span>
          Amazon reprices <strong>automatically via eSagu</strong> (margin recovery, cost floor, FBA guard — all running). Below is
          the live worklist: pick items that are too low or in the wrong band, choose a target tier, and <strong>push the floor to
          eSagu</strong> — it then optimises up from there. We're setting bounds, not fighting the engine. Click a card to filter.
        </span>
      </div>

      {/* Clickable summary cards (double as the filter) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {sumLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : (
          <>
            {chip("optimising", summary?.total ?? 0, "under eSagu control", "border-border bg-muted/30")}
            {chip("hold the buy box", holdPct == null ? "—" : `${holdPct}%`, `${summary?.we_hold_box ?? 0} items`, "border-emerald-500/40 bg-emerald-500/10")}
            {chip("below cost floor", summary?.below_floor ?? 0, "selling under break-even", STATUS_META.below_floor.cls, "below_floor")}
            {chip("losing buy box", summary?.losing_box ?? 0, "a competitor holds it", STATUS_META.losing_box.cls, "losing_box")}
            {chip("stuck in FBA", summary?.stuck_fba ?? 0, "floor > market", STATUS_META.stuck_fba.cls, "stuck_fba")}
            {chip("margin headroom", summary?.margin_headroom ?? 0, "capped below market", STATUS_META.margin_headroom.cls, "margin_headroom")}
          </>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">
            Amazon worklist
            {statusFilter !== "all" && <Badge variant="outline" className="ml-2 font-normal">{STATUS_META[statusFilter].label}</Badge>}
          </CardTitle>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Move prices to</label>
              <Select value={tier} onValueChange={(v) => { setTier(v as Tier); setSelected({}); }}>
                <SelectTrigger className="w-[150px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIER_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => pushMut.mutate()}
              disabled={selectedRows.length === 0 || pushMut.isPending}
              className="bg-pd-accent hover:bg-pd-accent-light h-9"
            >
              {pushMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Push {selectedRows.length || ""} to eSagu
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rowsLoading ? (
            <Skeleton className="h-64" />
          ) : filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2 py-8 justify-center">
              <Info className="h-4 w-4" /> Nothing needs attention in this view — eSagu has it covered.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={allChecked}
                        onCheckedChange={(c) => {
                          const next: Record<number, boolean> = { ...selected };
                          sellable.forEach((r) => { next[r.esagu_item_id] = !!c; });
                          setSelected(next);
                        }}
                      />
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>ASIN</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Band now</TableHead>
                    <TableHead className="text-right">Floor</TableHead>
                    <TableHead className="text-right">Target ({tier})</TableHead>
                    <TableHead className="text-right">Market</TableHead>
                    <TableHead>Buy box</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const meta = STATUS_META[r.status as StatusKey];
                    const band = r.current_por != null ? classifyPorBand(Number(r.current_por) * 100) : null;
                    const sellableRow = r.target_price != null;
                    return (
                      <TableRow key={r.esagu_item_id}>
                        <TableCell>
                          <Checkbox
                            checked={!!selected[r.esagu_item_id]}
                            disabled={!sellableRow}
                            onCheckedChange={(c) => setSelected((s) => ({ ...s, [r.esagu_item_id]: !!c }))}
                          />
                        </TableCell>
                        <TableCell>{meta && <Badge variant="outline" className={meta.cls}>{meta.label}</Badge>}</TableCell>
                        <TableCell className="font-mono text-xs">{r.sku ?? <span className="text-muted-foreground">no cost map</span>}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <a href={`https://www.amazon.co.uk/dp/${r.asin}`} target="_blank" rel="noreferrer" className="text-pd-accent hover:underline">{r.asin}</a>
                        </TableCell>
                        <TableCell><Badge variant="secondary" className="text-[10px]">{r.fba ? "FBA" : "FBM"}</Badge></TableCell>
                        <TableCell className="text-right">{fmtGBP(r.amazon_price)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{band ?? "—"}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtGBP(r.cost_floor)}</TableCell>
                        <TableCell className="text-right font-medium">{fmtGBP(r.target_price)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtGBP(r.competable_price)}</TableCell>
                        <TableCell className="text-xs">
                          {r.we_hold_box ? <span className="text-emerald-500">You</span>
                            : r.buy_box_seller ? <span className="text-muted-foreground">{r.buy_box_seller}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="text-[10px] text-muted-foreground/70 mt-2">
                Push sets each selected item's eSagu <strong>floor</strong> (minimum) to the {tier}-tier price; eSagu optimises upward from there.
                Rows without a cost map can't be tiered. Up to 400 items shown, worst first.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
