import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RotateCcw, AlertTriangle, TrendingDown, TrendingUp, Check, Loader2 } from "lucide-react";
import { format } from "date-fns";

const gbp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const pct = (n: number | null | undefined) => (n == null ? null : `${n >= 0 ? "+" : ""}${n}%`);

interface WeekPoint { iso_week: number; week_start: string; units: number; avg_price: number; profit: number; }
interface Experiment {
  id: string; store_id: string; store_name: string; sku: string;
  baseline_price: number; new_price: number; change_pct: number | null;
  started_at: string; status: string;
  baseline_weekly_units: number; recent_weekly_units: number | null; velocity_change_pct: number | null;
  baseline_weekly_profit: number; recent_weekly_profit: number | null; profit_change_pct: number | null;
  complete_weeks: number; maturity: "settling" | "early" | "measuring"; measure_start: string;
  disrupted: boolean; series: WeekPoint[];
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

  const setStatus = useMutation({
    mutationFn: async ({ e, status, pushBaseline }: { e: Experiment; status: string; pushBaseline: boolean }) => {
      if (pushBaseline) {
        const { data, error } = await supabase.functions.invoke("threeds-reprice-push", {
          body: { store_id: e.store_id, rows: [{ sku: e.sku, new_price: Number(e.baseline_price) }] },
        });
        if (error || (data as any)?.error) throw new Error(error?.message ?? (data as any)?.error ?? "revert push failed");
      }
      const patch: Record<string, unknown> = { status };
      if (status === "reverted") patch.reverted_at = new Date().toISOString();
      const { error: upErr } = await (supabase as any).from("price_experiments").update(patch).eq("id", e.id);
      if (upErr) throw new Error(upErr.message);
      return { e, status };
    },
    onSuccess: ({ e, status }) => {
      toast({
        title: status === "reverted" ? "Reverted" : "Kept",
        description: status === "reverted"
          ? `${e.sku} queued back to ${gbp(e.baseline_price)} — pushes on the next 3D import.`
          : `${e.sku} marked as kept — stopped tracking, price stays at ${gbp(e.new_price)}.`,
      });
      qc.invalidateQueries({ queryKey: ["price_experiments"] });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });
  const busy = setStatus.isPending;

  const rows = data ?? [];

  // Was→now delta cell, coloured. "up" = higher-is-good (profit); for velocity, down is bad.
  const delta = (was: number, now: number | null, changePct: number | null, goodWhenUp = true) => {
    if (now == null || changePct == null) return <span className="text-muted-foreground text-xs">—</span>;
    const good = goodWhenUp ? changePct >= 0 : changePct >= 0;
    return (
      <span className="whitespace-nowrap">
        {goodWhenUp ? gbp(was) : was.toFixed(1)} <span className="text-muted-foreground">→</span>{" "}
        {goodWhenUp ? gbp(now) : now.toFixed(1)}
        <span className={`ml-1 text-xs inline-flex items-center ${good ? "text-success" : "text-warning"}`}>
          {changePct >= 0 ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
          {pct(changePct)}
        </span>
      </span>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tracked price moves</CardTitle>
        <CardDescription>
          Deliberate price changes and their weekly result since. Baseline = the price before the move — the number to
          revert to. Measurement starts the first full week at the new price (dead weeks count as zero); the ⚠ flag holds
          off until there are 2 full weeks. <strong>Contribution /wk</strong> is the real verdict — a rise wins if contribution holds
          even on fewer units.
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
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Sales /wk</TableHead>
                <TableHead className="text-right">Contribution /wk</TableHead>
                <TableHead>Weeks @ new price</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id} className={e.disrupted ? "bg-destructive/5" : ""}>
                  <TableCell className="font-mono text-xs">{e.sku}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.store_name}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {gbp(e.baseline_price)} <span className="text-muted-foreground">→</span>{" "}
                    <span className="font-medium">{gbp(e.new_price)}</span>
                    {e.change_pct != null && (
                      <span className={`ml-1 text-xs ${e.change_pct >= 0 ? "text-success" : "text-destructive"}`}>
                        ({pct(e.change_pct)})
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {e.disrupted ? (
                      <Badge variant="secondary" className="border-destructive/50 bg-destructive/15 text-destructive text-[11px] whitespace-nowrap">
                        <AlertTriangle className="h-3 w-3 mr-1" /> disrupted
                      </Badge>
                    ) : e.maturity === "settling" ? (
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        settling · reads {format(new Date(e.measure_start), "d MMM")}
                      </span>
                    ) : e.maturity === "early" ? (
                      <Badge variant="secondary" className="text-[11px]">wk 1 · early read</Badge>
                    ) : (
                      <Badge variant="secondary" className="border-success/40 bg-success/10 text-success text-[11px]">
                        measuring · {e.complete_weeks}w
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{delta(e.baseline_weekly_units, e.recent_weekly_units, e.velocity_change_pct, false)}</TableCell>
                  <TableCell className="text-right">{delta(e.baseline_weekly_profit, e.recent_weekly_profit, e.profit_change_pct, true)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[260px]">
                      {(e.series ?? []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : e.series.map((w) => (
                        <span key={w.iso_week} className="text-[10px] font-mono px-1 py-0.5 rounded bg-muted whitespace-nowrap"
                          title={`Week ${w.iso_week} — ${w.units} @ ${gbp(w.avg_price)}, profit ${gbp(w.profit)}`}>
                          W{w.iso_week}: {w.units}@{gbp(w.avg_price)}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="mr-1" disabled={busy}
                      onClick={() => setStatus.mutate({ e, status: "kept", pushBaseline: false })}
                      title={`Keep ${e.sku} at ${gbp(e.new_price)} and stop tracking`}>
                      <Check className="h-3 w-3 mr-1" /> Keep
                    </Button>
                    <Button size="sm" variant={e.disrupted ? "default" : "outline"} disabled={busy}
                      onClick={() => setStatus.mutate({ e, status: "reverted", pushBaseline: true })}
                      title={`Queue ${e.sku} back to ${gbp(e.baseline_price)}`}>
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RotateCcw className="h-3 w-3 mr-1" /> Revert</>}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
