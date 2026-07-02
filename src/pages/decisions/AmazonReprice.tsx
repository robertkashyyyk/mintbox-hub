import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bot, Info } from "lucide-react";

// Amazon reprices AUTONOMOUSLY via eSagu (margin recovery, cost floor, FBA guard —
// all cron'd). This panel is a live MONITORING view + worklist, not a manual push
// (pushing here would race the eSagu engine). Overrides go through eSagu, not SFTP.

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
  const [statusFilter, setStatusFilter] = useState<"all" | StatusKey>("all");

  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ["amazon-reprice-summary"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_amazon_reprice_summary");
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
  });

  const { data: rows, isLoading: rowsLoading } = useQuery({
    queryKey: ["amazon-reprice-overview"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_amazon_reprice_overview", { p_limit: 400 });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => statusFilter === "all" || r.status === statusFilter),
    [rows, statusFilter],
  );

  const holdPct = summary && summary.total ? Math.round((100 * summary.we_hold_box) / summary.total) : null;

  const chip = (label: string, value: string | number, sub?: string, tone?: string) => (
    <div className={`rounded-lg border px-3 py-2 ${tone ?? "border-border bg-muted/30"}`}>
      <div className="text-lg font-semibold leading-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground/70">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* How Amazon repricing works — set expectations (no manual push) */}
      <div className="rounded-lg border border-pd-accent/30 bg-pd-accent/5 px-3 py-2 text-xs text-foreground/80 flex items-start gap-2">
        <Bot className="h-4 w-4 flex-shrink-0 mt-0.5 text-pd-accent" />
        <span>
          Amazon reprices <strong>automatically via eSagu</strong> — margin recovery, cost floor and the FBA guard all run on
          their own schedule. This is the live picture and the worklist of items that need attention; there's no manual push to
          make here (that would race the engine). Clearance overrides route through the{" "}
          <a href="/decisions/liquidation" className="underline">Clearance</a> page.
        </span>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {sumLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : (
          <>
            {chip("optimising", summary?.total ?? 0, "under eSagu control")}
            {chip("hold the buy box", holdPct == null ? "—" : `${holdPct}%`, `${summary?.we_hold_box ?? 0} items`, "border-emerald-500/40 bg-emerald-500/10")}
            {chip("below cost floor", summary?.below_floor ?? 0, "selling under break-even", STATUS_META.below_floor.cls)}
            {chip("losing buy box", summary?.losing_box ?? 0, "a competitor holds it", STATUS_META.losing_box.cls)}
            {chip("stuck in FBA", summary?.stuck_fba ?? 0, "floor > market", STATUS_META.stuck_fba.cls)}
            {chip("margin headroom", summary?.margin_headroom ?? 0, "capped below market", STATUS_META.margin_headroom.cls)}
          </>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Amazon worklist</CardTitle>
          <ToggleGroup type="single" value={statusFilter} onValueChange={(v) => v && setStatusFilter(v as any)} className="justify-start flex-wrap">
            <ToggleGroupItem value="all" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white text-xs px-3 h-8">All</ToggleGroupItem>
            <ToggleGroupItem value="below_floor" className="data-[state=on]:bg-destructive data-[state=on]:text-white text-xs px-3 h-8">Below floor</ToggleGroupItem>
            <ToggleGroupItem value="losing_box" className="data-[state=on]:bg-warning data-[state=on]:text-white text-xs px-3 h-8">Losing box</ToggleGroupItem>
            <ToggleGroupItem value="stuck_fba" className="data-[state=on]:bg-orange-500 data-[state=on]:text-white text-xs px-3 h-8">Stuck FBA</ToggleGroupItem>
            <ToggleGroupItem value="margin_headroom" className="data-[state=on]:bg-pd-accent data-[state=on]:text-white text-xs px-3 h-8">Headroom</ToggleGroupItem>
          </ToggleGroup>
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
                    <TableHead>Status</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>ASIN</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Min</TableHead>
                    <TableHead className="text-right">Max</TableHead>
                    <TableHead className="text-right">Floor</TableHead>
                    <TableHead className="text-right">Market</TableHead>
                    <TableHead>Buy box</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const meta = STATUS_META[r.status as StatusKey];
                    return (
                      <TableRow key={r.esagu_item_id}>
                        <TableCell>
                          {meta && <Badge variant="outline" className={meta.cls}>{meta.label}</Badge>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.sku ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <a href={`https://www.amazon.co.uk/dp/${r.asin}`} target="_blank" rel="noreferrer" className="text-pd-accent hover:underline">{r.asin}</a>
                        </TableCell>
                        <TableCell><Badge variant="secondary" className="text-[10px]">{r.fba ? "FBA" : "FBM"}</Badge></TableCell>
                        <TableCell className="text-right">{fmtGBP(r.amazon_price)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtGBP(r.min_price)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtGBP(r.max_price)}</TableCell>
                        <TableCell className="text-right">{fmtGBP(r.cost_floor)}</TableCell>
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
              <p className="text-[10px] text-muted-foreground/70 mt-2">Showing up to 400 items needing attention, worst first. Full catalogue reprices under eSagu.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
