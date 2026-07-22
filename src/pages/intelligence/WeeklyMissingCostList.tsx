import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageLoader } from "@/components/ui/PageLoader";
import { CalendarClock, Loader2, Save, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { logActivity, LOG_ACTIONS } from "@/lib/activityLog";

type WeeklyItem = {
  id: string;
  week_start: string;
  rank: number;
  sku: string;
  name: string | null;
  brand_name: string | null;
  mintsoft_product_id: number | null;
  velocity_per_week: number | null;
  units_sold_90d: number | null;
  current_stock: number | null;
  status: "pending" | "done";
  cost_entered: number | null;
  sent_at: string | null;
};

// This week's cron-generated worklist: the top missing-cost SKUs by sales
// velocity. Enter a cost, push to Mintsoft, and the row drops off the list.
export default function WeeklyMissingCostList() {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["weekly-missing-costs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_weekly_missing_cost_list");
      if (error) throw error;
      return (data ?? []) as WeeklyItem[];
    },
  });

  const pending = useMemo(() => items.filter((i) => i.status === "pending"), [items]);
  const doneCount = items.length - pending.length;
  const weekStart = items[0]?.week_start;

  function dropDone(ids: string[]) {
    const set = new Set(ids);
    qc.setQueryData<WeeklyItem[]>(["weekly-missing-costs"], (old) =>
      (old ?? []).map((i) => (set.has(i.id) ? { ...i, status: "done" as const } : i))
    );
    // keep the main brand summary honest
    qc.invalidateQueries({ queryKey: ["missing-cost-brand-summary"] });
  }

  async function sendOne(item: WeeklyItem) {
    const val = Number(edits[item.id]);
    if (!Number.isFinite(val) || val <= 0 || val > 100000) { toast.error("Enter a valid cost between 0 and 100,000"); return; }
    if (!item.mintsoft_product_id) { toast.error(`No Mintsoft product ID for ${item.sku}`); return; }
    setSaving((s) => ({ ...s, [item.id]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("update-product-cost", {
        body: { items: [{ mintsoft_product_id: item.mintsoft_product_id, sku: item.sku, cost_price: val }] },
      });
      if (error) throw error;
      const result = data?.results?.[0];
      if (!result?.ok) throw new Error(result?.error ?? "Unknown error");
      await (supabase as any).rpc("mark_weekly_missing_cost_done", { p_id: item.id, p_cost: val });
      logActivity({ action: LOG_ACTIONS.COST_UPDATE, entityType: "product", entityId: item.id, entityLabel: item.sku, detail: { cost_price: val, source: "weekly_list" } });
      toast.success(`${item.sku}: £${val.toFixed(2)} sent to Mintsoft`);
      setEdits((e) => { const n = { ...e }; delete n[item.id]; return n; });
      dropDone([item.id]);
    } catch (e: any) {
      toast.error(`${item.sku}: ${e?.message ?? "Failed"}`);
    } finally {
      setSaving((s) => { const n = { ...s }; delete n[item.id]; return n; });
    }
  }

  async function sendAll() {
    const batch = pending
      .filter((i) => edits[i.id] && i.mintsoft_product_id)
      .map((i) => ({ item: i, val: Number(edits[i.id]) }))
      .filter(({ val }) => Number.isFinite(val) && val > 0 && val <= 100000);
    if (batch.length === 0) { toast.error("No valid costs entered"); return; }

    const payload = batch.map(({ item, val }) => ({ mintsoft_product_id: item.mintsoft_product_id!, sku: item.sku, cost_price: val }));
    try {
      const { data, error } = await supabase.functions.invoke("update-product-cost", { body: { items: payload } });
      if (error) throw error;
      const okItems = batch.filter(({ item }) => (data?.results ?? []).some((r: any) => r.sku === item.sku && r.ok));
      for (const { item, val } of okItems) {
        await (supabase as any).rpc("mark_weekly_missing_cost_done", { p_id: item.id, p_cost: val });
        setEdits((e) => { const n = { ...e }; delete n[item.id]; return n; });
      }
      if (okItems.length) {
        logActivity({ action: LOG_ACTIONS.COST_BULK_UPDATE, detail: { updated: okItems.length, source: "weekly_list" }, outcome: "success" });
        toast.success(`${okItems.length} cost${okItems.length > 1 ? "s" : ""} sent to Mintsoft`);
        dropDone(okItems.map(({ item }) => item.id));
      }
      const failed = batch.length - okItems.length;
      if (failed > 0) toast.error(`${failed} failed to send`);
    } catch (e: any) {
      toast.error(`Batch failed: ${e?.message}`);
    }
  }

  async function sendTestEmail() {
    setTesting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const email = u?.user?.email;
      if (!email) { toast.error("No email on your account"); return; }
      const { data, error } = await supabase.functions.invoke("weekly-missing-costs-run", {
        body: { test: true, test_email: email },
      });
      if (error) throw error;
      if ((data as any)?.emailed) toast.success(`Test sent to ${email}`);
      else toast.message((data as any)?.note ?? "Nothing to send");
    } catch (e: any) {
      toast.error(`Test failed: ${e?.message ?? "error"}`);
    } finally {
      setTesting(false);
    }
  }

  if (!isLoading && items.length === 0) return null; // no run yet — hide entirely

  return (
    <Card className="border-pd-accent/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-pd-accent" />
            <div>
              <CardTitle className="text-base">This week's list</CardTitle>
              <CardDescription>
                Top {items.length} best-selling SKUs still missing a cost{weekStart ? ` · week of ${new Date(weekStart).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}. Highest data impact first.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> {doneCount}/{items.length} done</Badge>
            <Button size="sm" variant="outline" onClick={sendTestEmail} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Email me a test
            </Button>
            <Button size="sm" onClick={sendAll} disabled={Object.keys(edits).length === 0}>
              <Save className="h-4 w-4 mr-1" /> Send entered to Mintsoft
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <PageLoader rows={5} columns={[60, 140, 260, 90, 90]} label="Loading this week's list" />
        ) : pending.length === 0 ? (
          <div className="text-sm text-foreground/70 py-6 text-center">🎉 Every SKU on this week's list has been priced. Nice work.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Velocity</TableHead>
                  <TableHead className="text-right">Sold 90d</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Cost £</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((item) => {
                  const isSaving = !!saving[item.id];
                  const noMs = !item.mintsoft_product_id;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs text-muted-foreground">{item.rank}</TableCell>
                      <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                      <TableCell className="max-w-md truncate" title={item.name ?? ""}>{item.name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.velocity_per_week != null ? `${Number(item.velocity_per_week).toFixed(1)}/wk` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.units_sold_90d ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.current_stock ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00"
                          value={edits[item.id] ?? ""}
                          onChange={(e) => setEdits((s) => ({ ...s, [item.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") sendOne(item); }}
                          className="w-24 ml-auto h-8 text-right"
                          disabled={isSaving || noMs}
                          title={noMs ? "No Mintsoft product ID" : undefined}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => sendOne(item)} disabled={isSaving || noMs || !edits[item.id]}>
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
