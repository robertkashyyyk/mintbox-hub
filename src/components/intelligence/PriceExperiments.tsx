import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RotateCcw, AlertTriangle, TrendingDown, TrendingUp, Loader2 } from "lucide-react";

const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

interface WeekPoint { iso_week: number; week_start: string; units: number; avg_price: number; phase: "before" | "after"; }
interface Experiment {
  id: string; store_id: string; store_name: string; sku: string;
  baseline_price: number; new_price: number; change_pct: number | null;
  started_at: string; status: string;
  baseline_weekly_units: number; recent_weekly_units: number; velocity_change_pct: number | null;
  weeks_tracked: number; disrupted: boolean; series: WeekPoint[];
}

export function PriceExperiments() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["price_experiments"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_price_experiments", { p_include_closed: false });
      if (error) throw error;
      return (data ?? []) as Experiment[];
    },
  });

  const revert = useMutation({
    mutationFn: async (e: Experiment) => {
      const { data, error } = await supabase.functions.invoke("threeds-reprice-push", {
        body: { store_id: e.store_id, rows: [{ sku: e.sku, new_price: Number(e.baseline_price) }] },
      });
      if (error || (data as any)?.error) throw new Error(error?.message ?? (data as any)?.error ?? "revert push failed");
      const { error: upErr } = await (supabase as any).from("price_experiments")
        .update({ status: "reverted", reverted_at: new Date().toISOString() }).eq("id", e.id);
      if (upErr) throw new Error(upErr.message);
      return e;
    },
    onSuccess: (e) => {
      toast({ title: "Reverted", description: `${e.sku} queued back to ${gbp(e.baseline_price)} — pushes on the next 3D import.` });
      qc.invalidateQueries({ queryKey: ["price_experiments"] });
    },
    onError: (err: Error) => toast({ title: "Revert failed", description: err.message, variant: "destructive" }),
  });

  const rows = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tracked price moves</CardTitle>
        <CardDescription>
          Deliberate price changes and their weekly sales velocity since. Baseline = the price before the move — the
          number to revert to if the change disrupts sales. Dead weeks count as zero, so a real drop shows up.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No tracked price moves yet — use <strong>“Push &amp; Track”</strong> on the Reprice page to start one.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Store</TableHead>
                <TableHead className="text-right">Baseline → New</TableHead>
                <TableHead className="text-right">Was /wk</TableHead>
                <TableHead className="text-right">Now /wk</TableHead>
                <TableHead className="text-right">Δ velocity</TableHead>
                <TableHead>Weeks @ price</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => {
                const after = (e.series ?? []).filter((w) => w.phase === "after");
                return (
                  <TableRow key={e.id} className={e.disrupted ? "bg-destructive/5" : ""}>
                    <TableCell className="font-mono text-xs">{e.sku}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{e.store_name}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {gbp(e.baseline_price)} <span className="text-muted-foreground">→</span>{" "}
                      <span className="font-medium">{gbp(e.new_price)}</span>
                      {e.change_pct != null && (
                        <span className={`ml-1 text-xs ${e.change_pct >= 0 ? "text-success" : "text-destructive"}`}>
                          ({e.change_pct >= 0 ? "+" : ""}{e.change_pct}%)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{e.baseline_weekly_units?.toFixed(1) ?? "—"}</TableCell>
                    <TableCell className="text-right">{e.recent_weekly_units?.toFixed(1) ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {e.velocity_change_pct == null ? (
                        <span className="text-muted-foreground text-xs">n/a</span>
                      ) : e.disrupted ? (
                        <Badge variant="secondary" className="border-destructive/50 bg-destructive/15 text-destructive text-[11px] whitespace-nowrap">
                          <AlertTriangle className="h-3 w-3 mr-1" /> {e.velocity_change_pct}%
                        </Badge>
                      ) : (
                        <span className={`inline-flex items-center text-xs ${e.velocity_change_pct >= 0 ? "text-success" : "text-warning"}`}>
                          {e.velocity_change_pct >= 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                          {e.velocity_change_pct >= 0 ? "+" : ""}{e.velocity_change_pct}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[280px]">
                        {after.length === 0 ? (
                          <span className="text-xs text-muted-foreground">no sales yet</span>
                        ) : after.map((w) => (
                          <span key={w.iso_week} className="text-[10px] font-mono px-1 py-0.5 rounded bg-muted whitespace-nowrap"
                            title={`Week ${w.iso_week} — ${w.units} @ ${gbp(w.avg_price)}`}>
                            W{w.iso_week}: {w.units}@{gbp(w.avg_price)}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant={e.disrupted ? "default" : "outline"}
                        onClick={() => revert.mutate(e)} disabled={revert.isPending}
                        title={`Queue ${e.sku} back to ${gbp(e.baseline_price)}`}>
                        {revert.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RotateCcw className="h-3 w-3 mr-1" /> Revert</>}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
