import { useEffect, useMemo, useState } from "react";
import { format, startOfWeek, subWeeks } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { Loader2, RefreshCw, TrendingDown, TrendingUp, AlertTriangle } from "lucide-react";

type Penalty = {
  id: string;
  carrier_id: string;
  document_id: string | null;
  tracking_number: string | null;
  penalty_amount: number;
  reason_code: string | null;
  reason_text: string | null;
  declared_format: string | null;
  actual_format: string | null;
  penalty_date: string | null;
  sku: string | null;
  mintsoft_order_id: number | null;
  resolution_status: string;
};
type Carrier = { id: string; name: string };

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  unresolved: { label: "Unresolved", className: "bg-muted text-muted-foreground" },
  order_found: { label: "Order found", className: "bg-blue-500/15 text-blue-300 border border-blue-500/30" },
  sku_found: { label: "SKU found", className: "bg-blue-500/15 text-blue-300 border border-blue-500/30" },
  remeasure_pending: { label: "Remeasure pending", className: "bg-amber-500/15 text-amber-300 border border-amber-500/30" },
  remeasured: { label: "Remeasured", className: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" },
  packer_issue: { label: "Packer issue", className: "bg-destructive/15 text-destructive border border-destructive/30" },
  written_off: { label: "Written off", className: "bg-muted text-muted-foreground" },
};

const CarrierPenalties = () => {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [loading, setLoading] = useState(true);
  const [carrierFilter, setCarrierFilter] = useState<string>("all");
  const [weeks, setWeeks] = useState<number>(8);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks]);

  async function load() {
    setLoading(true);
    const sinceDate = format(subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weeks), "yyyy-MM-dd");
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from("carriers").select("id, name").order("name"),
      supabase
        .from("carrier_penalties")
        .select("id, carrier_id, document_id, tracking_number, penalty_amount, reason_code, reason_text, declared_format, actual_format, penalty_date, sku, mintsoft_order_id, resolution_status")
        .gte("penalty_date", sinceDate)
        .order("penalty_date", { ascending: false })
        .limit(2000),
    ]);
    setCarriers((c as Carrier[]) ?? []);
    setPenalties((p as Penalty[]) ?? []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    if (carrierFilter === "all") return penalties;
    return penalties.filter((p) => p.carrier_id === carrierFilter);
  }, [penalties, carrierFilter]);

  // KPIs
  const stats = useMemo(() => {
    const total = filtered.reduce((acc, p) => acc + Number(p.penalty_amount || 0), 0);
    const count = filtered.length;
    const unresolved = filtered.filter((p) => p.resolution_status === "unresolved").length;
    const remeasured = filtered.filter((p) => p.resolution_status === "remeasured").length;

    // Last vs prior week
    const thisWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const prevWeekStart = subWeeks(thisWeekStart, 1);
    const lastWeek = filtered
      .filter((p) => p.penalty_date && new Date(p.penalty_date) >= thisWeekStart)
      .reduce((a, p) => a + Number(p.penalty_amount || 0), 0);
    const priorWeek = filtered
      .filter((p) => p.penalty_date && new Date(p.penalty_date) >= prevWeekStart && new Date(p.penalty_date) < thisWeekStart)
      .reduce((a, p) => a + Number(p.penalty_amount || 0), 0);
    const wow = priorWeek > 0 ? ((lastWeek - priorWeek) / priorWeek) * 100 : null;

    return { total, count, unresolved, remeasured, lastWeek, priorWeek, wow };
  }, [filtered]);

  // Weekly trend chart
  const weeklyTrend = useMemo(() => {
    const buckets = new Map<string, { week: string; amount: number; count: number }>();
    for (let i = weeks; i >= 0; i--) {
      const d = subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), i);
      const key = format(d, "yyyy-MM-dd");
      buckets.set(key, { week: format(d, "dd MMM"), amount: 0, count: 0 });
    }
    filtered.forEach((p) => {
      if (!p.penalty_date) return;
      const wk = format(startOfWeek(new Date(p.penalty_date), { weekStartsOn: 1 }), "yyyy-MM-dd");
      const b = buckets.get(wk);
      if (b) {
        b.amount += Number(p.penalty_amount || 0);
        b.count += 1;
      }
    });
    return Array.from(buckets.values());
  }, [filtered, weeks]);

  // Reason breakdown
  const reasonBreakdown = useMemo(() => {
    const map = new Map<string, { reason: string; amount: number; count: number }>();
    filtered.forEach((p) => {
      const r = p.reason_code || p.reason_text || "Unspecified";
      const e = map.get(r) ?? { reason: r, amount: 0, count: 0 };
      e.amount += Number(p.penalty_amount || 0);
      e.count += 1;
      map.set(r, e);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount).slice(0, 10);
  }, [filtered]);

  // Top SKUs
  const topSkus = useMemo(() => {
    const map = new Map<string, { sku: string; amount: number; count: number }>();
    filtered.forEach((p) => {
      if (!p.sku) return;
      const e = map.get(p.sku) ?? { sku: p.sku, amount: 0, count: 0 };
      e.amount += Number(p.penalty_amount || 0);
      e.count += 1;
      map.set(p.sku, e);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount).slice(0, 10);
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Penalties Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Weekly trend, reason breakdown, and the SKUs costing you most.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={carrierFilter} onValueChange={setCarrierFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All carriers</SelectItem>
              {carriers.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(weeks)} onValueChange={(v) => setWeeks(Number(v))}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="4">Last 4 weeks</SelectItem>
              <SelectItem value="8">Last 8 weeks</SelectItem>
              <SelectItem value="13">Last 13 weeks</SelectItem>
              <SelectItem value="26">Last 26 weeks</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Total cost</div>
            <div className="text-2xl font-bold mt-1">£{stats.total.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Penalties</div>
            <div className="text-2xl font-bold mt-1">{stats.count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">This week</div>
            <div className="text-2xl font-bold mt-1">£{stats.lastWeek.toFixed(2)}</div>
            {stats.wow !== null && (
              <div className={`text-xs mt-1 flex items-center gap-1 ${stats.wow <= 0 ? "text-emerald-400" : "text-destructive"}`}>
                {stats.wow <= 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                {Math.abs(stats.wow).toFixed(0)}% vs prior week
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Unresolved</div>
            <div className="text-2xl font-bold mt-1">{stats.unresolved}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Remeasured</div>
            <div className="text-2xl font-bold mt-1 text-emerald-400">{stats.remeasured}</div>
          </CardContent>
        </Card>
      </div>

      {/* Weekly trend */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly cost trend</CardTitle>
          <CardDescription>Total £ penalised per week.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `£${v}`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  formatter={(value: number, name: string) => name === "amount" ? [`£${value.toFixed(2)}`, "Cost"] : [value, "Penalties"]}
                />
                <Legend />
                <Bar dataKey="amount" name="Cost (£)" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Top reasons</CardTitle>
            <CardDescription>Where the money is going.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reasonBreakdown.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>
                  )}
                  {reasonBreakdown.map((r) => (
                    <TableRow key={r.reason}>
                      <TableCell className="font-medium">{r.reason}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right font-mono">£{r.amount.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <CardTitle>Worst SKUs</CardTitle>
            </div>
            <CardDescription>Send these to the remeasure queue.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Hits</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topSkus.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No SKUs resolved yet — link penalties to orders first.</TableCell></TableRow>
                  )}
                  {topSkus.map((s) => (
                    <TableRow key={s.sku}>
                      <TableCell className="font-mono text-xs">{s.sku}</TableCell>
                      <TableCell className="text-right">{s.count}</TableCell>
                      <TableCell className="text-right font-mono">£{s.amount.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent penalties */}
      <Card>
        <CardHeader>
          <CardTitle>Recent penalties</CardTitle>
          <CardDescription>Latest line items extracted from documents.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Declared → Actual</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No penalties in this window.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.slice(0, 50).map((p) => {
                  const status = STATUS_VARIANTS[p.resolution_status] ?? STATUS_VARIANTS.unresolved;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.penalty_date ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{p.tracking_number ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.reason_code || p.reason_text || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.declared_format || "?"} → {p.actual_format || "?"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.sku ?? "—"}</TableCell>
                      <TableCell>
                        <Badge className={status.className} variant="outline">{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">£{Number(p.penalty_amount).toFixed(2)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CarrierPenalties;
