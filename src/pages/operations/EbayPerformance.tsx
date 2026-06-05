/**
 * eBay Performance — ODR tracker + customer response times
 * Replaces the manual "Customer Response Times & ODR Data" spreadsheet.
 *
 * Tabs:
 *   ODR          — weekly input + coloured table per account
 *   Response Times — daily message backlog input + trend
 *   History       — cross-account weekly overview
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Plus, Save, ShoppingBag, MessageSquare, BarChart3, Loader2, LineChart as LineChartIcon, TrendingUp } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { PageLoader } from "@/components/ui/PageLoader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, ReferenceLine,
} from "recharts";

// ── Types ────────────────────────────────────────────────────────

interface EbayAccount { id: string; code: string; name: string; sort_order: number }
interface OdrRow {
  id: string; account_id: string; year: number; week_number: number; week_start: string | null;
  cos_count: number | null; cos_pct: number | null;
  ccwsr_count: number | null; ccwsr_pct: number | null;
  ldr_count: number | null; ldr_pct: number | null;
  tdr_pct: number | null; notes: string | null;
}
interface ResponseTime {
  id: string; date: string; open_7d: number | null; open_14d: number | null; open_30d: number | null; notes: string | null;
}

// ── Threshold helpers ─────────────────────────────────────────────

// TDR tiers (%) — eBay hard limit 0.5%
function tdrTier(v: number | null): Tier {
  if (v == null) return "none";
  if (v <= 0.2) return "great";
  if (v <= 0.35) return "good";
  if (v <= 0.5) return "target";
  if (v <= 0.65) return "warn";
  return "critical";
}
// LDR tiers (%) — eBay hard limit 3%
function ldrTier(v: number | null): Tier {
  if (v == null) return "none";
  if (v <= 1) return "great";
  if (v <= 2) return "good";
  if (v <= 3) return "target";
  if (v <= 4) return "warn";
  return "critical";
}
// CoS/CCWSR tiers
function pcTier(v: number | null, crit: number): Tier {
  if (v == null) return "none";
  if (v < crit * 0.2) return "great";
  if (v < crit * 0.4) return "good";
  if (v < crit * 0.6) return "target";
  if (v < crit) return "warn";
  return "critical";
}
// Response time tiers (message count)
function rtTier(v: number | null): Tier {
  if (v == null) return "none";
  if (v <= 4) return "great";
  if (v <= 6) return "good";
  if (v <= 12) return "target";
  if (v <= 24) return "warn";
  return "critical";
}

type Tier = "great" | "good" | "target" | "warn" | "critical" | "none";

const TIER_CELL: Record<Tier, string> = {
  great:    "bg-emerald-500/15 text-emerald-400 font-semibold",
  good:     "bg-pd-accent/15 text-pd-accent font-semibold",
  target:   "bg-yellow-500/10 text-yellow-400 font-semibold",
  warn:     "bg-amber-500/15 text-amber-400 font-semibold",
  critical: "bg-destructive/15 text-destructive font-bold",
  none:     "text-muted-foreground",
};
const TIER_LABEL: Record<Tier, string> = {
  great: "Great", good: "Good", target: "On track", warn: "Needs work", critical: "Critical!", none: "—",
};

function TierCell({ value, tier, suffix = "%" }: { value: number | null; tier: Tier; suffix?: string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${TIER_CELL[tier]}`}>
      {value}{suffix}
    </span>
  );
}

// ── Breach task creator ───────────────────────────────────────────
async function createBreachTask(title: string, description: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await (supabase as any).from("tasks").insert({
    created_by: user.id,
    assigned_to: user.id,
    task_type: "system_generated",
    title,
    description,
    status: "todo",
    priority_level: 1,        // urgent
    user_urgency_flag: true,
    due_date: new Date().toISOString(),
    source_module: "ebay_performance",
    source_rule: "breach",
    tags: ["ebay", "breach"],
  });
}

// ── ISO week helpers ──────────────────────────────────────────────
function isoWeekStart(year: number, week: number): string {
  const jan4 = new Date(year, 0, 4);
  const day1 = new Date(jan4);
  day1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const start = new Date(day1);
  start.setDate(day1.getDate() + (week - 1) * 7);
  return start.toISOString().slice(0, 10);
}
function currentIsoWeek(): { year: number; week: number } {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7),
  };
}

// ── Blank ODR form state ──────────────────────────────────────────
function blankOdrForm() {
  return { cos_count: "", cos_pct: "", ccwsr_count: "", ccwsr_pct: "", ldr_count: "", ldr_pct: "", notes: "" };
}
type OdrFormFields = ReturnType<typeof blankOdrForm>;

// ═════════════════════════════════════════════════════════════════
// Main page
// ═════════════════════════════════════════════════════════════════

export default function EbayPerformance() {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="eBay Performance"
        description="ODR metrics (TDR, LDR) and customer response times across all eBay accounts."
        icon={ShoppingBag}
      />
      <Tabs defaultValue="odr">
        <TabsList>
          <TabsTrigger value="odr"><ShoppingBag className="h-4 w-4 mr-2" />ODR</TabsTrigger>
          <TabsTrigger value="response"><MessageSquare className="h-4 w-4 mr-2" />Response Times</TabsTrigger>
          <TabsTrigger value="graphs"><LineChartIcon className="h-4 w-4 mr-2" />Graphs</TabsTrigger>
          <TabsTrigger value="history"><BarChart3 className="h-4 w-4 mr-2" />History</TabsTrigger>
        </TabsList>
        <TabsContent value="odr" className="mt-6"><OdrTab /></TabsContent>
        <TabsContent value="response" className="mt-6"><ResponseTimesTab /></TabsContent>
        <TabsContent value="graphs" className="mt-6"><GraphsTab /></TabsContent>
        <TabsContent value="history" className="mt-6"><HistoryTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ODR Tab
// ═════════════════════════════════════════════════════════════════

function OdrTab() {
  const qc = useQueryClient();
  const cw = currentIsoWeek();
  const [year, setYear] = useState(cw.year);
  const [week, setWeek] = useState(cw.week);
  const [showForm, setShowForm] = useState(false);
  const [forms, setForms] = useState<Record<string, OdrFormFields>>({});

  const { data: accounts = [], isLoading: accsLoading } = useQuery({
    queryKey: ["ebay-accounts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("ebay_accounts").select("*").eq("active", true).order("sort_order");
      if (error) throw error;
      return data as EbayAccount[];
    },
  });

  const { data: existing = [], isLoading: existingLoading } = useQuery({
    queryKey: ["ebay-odr", year, week],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ebay_odr_with_tdr")
        .select("*")
        .eq("year", year)
        .eq("week_number", week);
      if (error) throw error;
      return data as OdrRow[];
    },
  });

  // Recent weeks for the table
  const { data: recent = [], isLoading: recentLoading } = useQuery({
    queryKey: ["ebay-odr-recent"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ebay_odr_with_tdr")
        .select("*, ebay_accounts(code, sort_order)")
        .order("year", { ascending: false })
        .order("week_number", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as (OdrRow & { ebay_accounts: { code: string; sort_order: number } })[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const rows = accounts.map(acc => {
        const f = forms[acc.id] ?? blankOdrForm();
        const n = (v: string) => v.trim() === "" ? null : Number(v);
        return {
          account_id: acc.id,
          year, week_number: week,
          week_start: isoWeekStart(year, week),
          cos_count: n(f.cos_count), cos_pct: n(f.cos_pct),
          ccwsr_count: n(f.ccwsr_count), ccwsr_pct: n(f.ccwsr_pct),
          ldr_count: n(f.ldr_count), ldr_pct: n(f.ldr_pct),
          notes: f.notes.trim() || null,
        };
      });
      const { error } = await (supabase as any)
        .from("ebay_odr_snapshots")
        .upsert(rows, { onConflict: "account_id,year,week_number" });
      if (error) throw error;
    },
    onSuccess: async (_, vars: any) => {
      toast.success(`Week ${week} ODR saved`);
      setShowForm(false);
      setForms({});
      qc.invalidateQueries({ queryKey: ["ebay-odr"] });
      qc.invalidateQueries({ queryKey: ["ebay-odr-recent"] });

      // Check for threshold breaches and create tasks
      const breachingAccounts: string[] = [];
      for (const acc of accounts) {
        const f = forms[acc.id] ?? blankOdrForm();
        const tdr = Number(f.cos_pct || 0) + Number(f.ccwsr_pct || 0);
        const ldr = Number(f.ldr_pct || 0);
        if (tdr > 0.5 || ldr > 3) breachingAccounts.push(acc.code);
      }
      if (breachingAccounts.length > 0) {
        toast.warning(`⚠️ Threshold breach on ${breachingAccounts.join(", ")} — task created`);
        await createBreachTask(
          `eBay ODR breach — Week ${week}: ${breachingAccounts.join(", ")}`,
          `One or more accounts exceeded eBay thresholds (TDR > 0.5% or LDR > 3%) in Week ${week} ${year}.\n\nAccounts: ${breachingAccounts.join(", ")}\n\nReview in Operations → eBay Performance and take corrective action.`
        );
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  function setField(accountId: string, field: keyof OdrFormFields, value: string) {
    setForms(prev => ({ ...prev, [accountId]: { ...(prev[accountId] ?? blankOdrForm()), [field]: value } }));
  }

  function openFormForWeek() {
    // Pre-fill from existing data if editing
    const prefill: Record<string, OdrFormFields> = {};
    for (const row of existing) {
      prefill[row.account_id] = {
        cos_count: row.cos_count?.toString() ?? "",
        cos_pct: row.cos_pct?.toString() ?? "",
        ccwsr_count: row.ccwsr_count?.toString() ?? "",
        ccwsr_pct: row.ccwsr_pct?.toString() ?? "",
        ldr_count: row.ldr_count?.toString() ?? "",
        ldr_pct: row.ldr_pct?.toString() ?? "",
        notes: row.notes ?? "",
      };
    }
    setForms(prefill);
    setShowForm(true);
  }

  // Alert: any account breaching thresholds?
  const breaches = recent.filter(r => {
    const tdr = (r.cos_pct ?? 0) + (r.ccwsr_pct ?? 0);
    return tdr > 0.5 || (r.ldr_pct ?? 0) > 3;
  }).slice(0, 5);

  // Group recent data by week for the display table
  const weekGroups = useMemo(() => {
    const map = new Map<string, typeof recent>();
    for (const r of recent) {
      const key = `${r.year}-W${String(r.week_number).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).slice(0, 12); // last 12 weeks
  }, [recent]);

  if (accsLoading) return <PageLoader rows={5} columns={[80, 100, 100, 100, 100, 100]} label="Loading accounts" />;

  return (
    <div className="space-y-6">
      {/* Threshold reference */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive inline-block" />TDR &gt; 0.5% — eBay breach</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500 inline-block" />LDR &gt; 3% — eBay breach</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />TDR ≤ 0.2% / LDR ≤ 1% — Great</span>
      </div>

      {/* Recent breach alert */}
      {breaches.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-destructive">Threshold breaches in recent data</p>
            <p className="text-xs text-muted-foreground mt-1">
              {breaches.map(r => {
                const code = r.ebay_accounts?.code ?? "?";
                const tdr = ((r.cos_pct ?? 0) + (r.ccwsr_pct ?? 0)).toFixed(2);
                const ldr = r.ldr_pct?.toFixed(2) ?? "—";
                return `${code} W${r.week_number} (TDR ${tdr}%, LDR ${ldr}%)`;
              }).join(" · ")}
            </p>
          </div>
        </div>
      )}

      {/* Week selector + entry */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle>Enter weekly ODR data</CardTitle>
              <CardDescription>Data from eBay Seller Hub — enter once per week per account</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-sm">Year</Label>
                <Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="w-20 h-8 text-sm" />
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-sm">Week</Label>
                <Input type="number" min={1} max={53} value={week} onChange={e => setWeek(Number(e.target.value))} className="w-16 h-8 text-sm" />
              </div>
              <Button size="sm" onClick={openFormForWeek}>
                <Plus className="h-4 w-4 mr-1" />{existing.length > 0 ? "Edit" : "Enter"} Week {week}
              </Button>
            </div>
          </div>
        </CardHeader>

        {showForm && (
          <CardContent className="border-t border-border pt-6">
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="pb-2 pr-4 font-medium">Account</th>
                      <th className="pb-2 px-2 font-medium">C O/S count</th>
                      <th className="pb-2 px-2 font-medium">C O/S %</th>
                      <th className="pb-2 px-2 font-medium">CCWSR count</th>
                      <th className="pb-2 px-2 font-medium">CCWSR %</th>
                      <th className="pb-2 px-2 font-medium">LDR count</th>
                      <th className="pb-2 px-2 font-medium">LDR %</th>
                      <th className="pb-2 px-2 font-medium text-amber-400">TDR % (auto)</th>
                      <th className="pb-2 pl-2 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map(acc => {
                      const f = forms[acc.id] ?? blankOdrForm();
                      const tdr = (Number(f.cos_pct || 0) + Number(f.ccwsr_pct || 0)).toFixed(4);
                      const tdrNum = parseFloat(tdr);
                      return (
                        <tr key={acc.id} className="border-b border-border/50 last:border-0">
                          <td className="py-2 pr-4">
                            <span className="font-mono font-semibold text-sm">{acc.code}</span>
                          </td>
                          {(["cos_count","cos_pct","ccwsr_count","ccwsr_pct","ldr_count","ldr_pct"] as (keyof OdrFormFields)[]).map(field => (
                            <td key={field} className="py-2 px-2">
                              <Input
                                type="number" step="any" min="0"
                                value={f[field]} onChange={e => setField(acc.id, field, e.target.value)}
                                className="w-24 h-7 text-sm"
                                placeholder="0"
                              />
                            </td>
                          ))}
                          <td className="py-2 px-2">
                            <span className={`text-sm font-semibold px-2 py-1 rounded ${tdrNum > 0.5 ? "bg-destructive/15 text-destructive" : tdrNum > 0.35 ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                              {f.cos_pct || f.ccwsr_pct ? tdr + "%" : "—"}
                            </span>
                          </td>
                          <td className="py-2 pl-2">
                            <Input value={f.notes} onChange={e => setField(acc.id, "notes", e.target.value)}
                              className="w-40 h-7 text-sm" placeholder="optional" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                  Save Week {week}
                </Button>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Recent weeks table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent weeks</CardTitle>
          <CardDescription>Last 12 weeks across all accounts. TDR = C O/S% + CCWSR%</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {recentLoading ? <PageLoader rows={6} columns={[60, 80, 80, 80, 80, 80, 80, 80]} label="Loading ODR data" /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">C O/S%</TableHead>
                    <TableHead className="text-right">CCWSR%</TableHead>
                    <TableHead className="text-right font-semibold">TDR%</TableHead>
                    <TableHead className="text-right">LDR count</TableHead>
                    <TableHead className="text-right">LDR%</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weekGroups.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No ODR data yet — enter a week above.
                    </TableCell></TableRow>
                  )}
                  {weekGroups.flatMap(([weekKey, rows]) =>
                    [...rows].sort((a, b) => (a.ebay_accounts?.sort_order ?? 0) - (b.ebay_accounts?.sort_order ?? 0))
                      .map((r, i) => {
                        const tdr = r.tdr_pct ?? ((r.cos_pct ?? 0) + (r.ccwsr_pct ?? 0));
                        const overallBreach = tdr > 0.5 || (r.ldr_pct ?? 0) > 3;
                        return (
                          <TableRow key={r.id} className={overallBreach ? "bg-destructive/5" : ""}>
                            {i === 0 && (
                              <TableCell rowSpan={rows.length} className="font-mono text-sm font-semibold align-top pt-3 border-r border-border/30">
                                {weekKey}
                              </TableCell>
                            )}
                            <TableCell><span className="font-mono font-bold text-sm">{r.ebay_accounts?.code ?? "?"}</span></TableCell>
                            <TableCell className="text-right"><TierCell value={r.cos_pct} tier={pcTier(r.cos_pct, 0.5)} /></TableCell>
                            <TableCell className="text-right"><TierCell value={r.ccwsr_pct} tier={pcTier(r.ccwsr_pct, 0.4)} /></TableCell>
                            <TableCell className="text-right"><TierCell value={Number(tdr.toFixed(4))} tier={tdrTier(tdr)} /></TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">{r.ldr_count ?? "—"}</TableCell>
                            <TableCell className="text-right"><TierCell value={r.ldr_pct} tier={ldrTier(r.ldr_pct)} /></TableCell>
                            <TableCell>
                              {overallBreach
                                ? <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30 text-xs">Breach</Badge>
                                : tdr > 0.35 || (r.ldr_pct ?? 0) > 2
                                ? <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">Watch</Badge>
                                : <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">OK</Badge>
                              }
                            </TableCell>
                          </TableRow>
                        );
                      })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// Response Times Tab
// ═════════════════════════════════════════════════════════════════

function ResponseTimesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [open7, setOpen7] = useState("");
  const [open14, setOpen14] = useState("");
  const [open30, setOpen30] = useState("");
  const [notes, setNotes] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["ebay-rt"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ebay_response_times")
        .select("*")
        .order("date", { ascending: false })
        .limit(90);
      if (error) throw error;
      return data as ResponseTime[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const n = (v: string) => v.trim() === "" ? null : Number(v);
      const { error } = await (supabase as any)
        .from("ebay_response_times")
        .upsert({ date, open_7d: n(open7), open_14d: n(open14), open_30d: n(open30), notes: notes.trim() || null },
          { onConflict: "date" });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Response time entry saved");
      // Check for breach — 7d > 12 is "needs attention", > 24 is critical
      const v7 = Number(open7 || 0), v14 = Number(open14 || 0), v30 = Number(open30 || 0);
      if (v7 > 24 || v14 > 24 || v30 > 30) {
        toast.warning("⚠️ Response times are critical — task created");
        await createBreachTask(
          `eBay response times critical — ${date}`,
          `Open message counts are above critical thresholds:\n7-day: ${v7} · 14-day: ${v14} · 30-day: ${v30}\n\nThresholds: 7d ≤ 24, 14d ≤ 24, 30d ≤ 30\n\nReview in Operations → eBay Performance.`
        );
      } else if (v7 > 12 || v14 > 12) {
        toast.warning("⚠️ Response times need attention — task created");
        await createBreachTask(
          `eBay response times need attention — ${date}`,
          `Open message counts are above normal thresholds:\n7-day: ${v7} · 14-day: ${v14} · 30-day: ${v30}\n\nReview in Operations → eBay Performance.`
        );
      }
      setShowForm(false); setOpen7(""); setOpen14(""); setOpen30(""); setNotes("");
      qc.invalidateQueries({ queryKey: ["ebay-rt"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Find the latest entry
  const latest = rows[0];
  const latestBreach = latest && ((latest.open_7d ?? 0) > 12 || (latest.open_14d ?? 0) > 24 || (latest.open_30d ?? 0) > 30);

  return (
    <div className="space-y-6">
      {latestBreach && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-400">Response times need attention</p>
            <p className="text-xs text-muted-foreground mt-1">
              Latest: 7d={latest.open_7d ?? "—"} · 14d={latest.open_14d ?? "—"} · 30d={latest.open_30d ?? "—"} ({latest.date})
            </p>
          </div>
        </div>
      )}

      {/* Entry form */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Log response times</CardTitle>
              <CardDescription>From 3D Sellers — open message counts in rolling windows</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowForm(s => !s)}>
              <Plus className="h-4 w-4 mr-1" />Add entry
            </Button>
          </div>
        </CardHeader>
        {showForm && (
          <CardContent className="border-t border-border pt-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label>7-day open</Label>
                <Input type="number" min={0} value={open7} onChange={e => setOpen7(e.target.value)} placeholder="0" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label>14-day open</Label>
                <Input type="number" min={0} value={open14} onChange={e => setOpen14(e.target.value)} placeholder="0" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label>30-day open</Label>
                <Input type="number" min={0} value={open30} onChange={e => setOpen30(e.target.value)} placeholder="0" className="h-9" />
              </div>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="h-9">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Save
              </Button>
            </div>
            <div className="mt-3">
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional — e.g. issue with 3D Seller response times)" rows={2} className="text-sm" />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Tier reference */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(["great","good","target","warn","critical"] as Tier[]).map(t => (
          <span key={t} className={`px-2 py-1 rounded ${TIER_CELL[t]}`}>
            {TIER_LABEL[t]}
          </span>
        ))}
        <span className="text-muted-foreground self-center">· thresholds: ≤4 Great · ≤6 Good · ≤12 Average · ≤24 Needs work · &gt;24 Critical</span>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent entries</CardTitle>
          <CardDescription>Last 90 days. Source: 3D Sellers.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <PageLoader rows={8} columns={[100, 80, 80, 80, 200]} label="Loading response times" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">7-day open</TableHead>
                  <TableHead className="text-right">14-day open</TableHead>
                  <TableHead className="text-right">30-day open</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No entries yet — click "Add entry" above.
                  </TableCell></TableRow>
                )}
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.date}</TableCell>
                    <TableCell className="text-right"><TierCell value={r.open_7d} tier={rtTier(r.open_7d)} suffix="" /></TableCell>
                    <TableCell className="text-right"><TierCell value={r.open_14d} tier={rtTier(r.open_14d)} suffix="" /></TableCell>
                    <TableCell className="text-right"><TierCell value={r.open_30d} tier={rtTier(r.open_30d)} suffix="" /></TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{r.notes ?? "—"}</TableCell>
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

// ═════════════════════════════════════════════════════════════════
// History Tab
// ═════════════════════════════════════════════════════════════════

function HistoryTab() {
  const { data: accounts = [] } = useQuery({
    queryKey: ["ebay-accounts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("ebay_accounts").select("*").eq("active", true).order("sort_order");
      if (error) throw error;
      return data as EbayAccount[];
    },
  });

  const { data: odrData = [], isLoading } = useQuery({
    queryKey: ["ebay-odr-history"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ebay_odr_with_tdr")
        .select("*, ebay_accounts(code, sort_order)")
        .order("year", { ascending: false })
        .order("week_number", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as (OdrRow & { ebay_accounts: { code: string; sort_order: number } })[];
    },
  });

  // Unique weeks
  const weeks = useMemo(() => {
    const seen = new Set<string>();
    const result: { key: string; year: number; week: number }[] = [];
    for (const r of odrData) {
      const key = `${r.year}-${r.week_number}`;
      if (!seen.has(key)) { seen.add(key); result.push({ key, year: r.year, week: r.week_number }); }
    }
    return result;
  }, [odrData]);

  if (isLoading) return <PageLoader rows={8} columns={[60, 80, 80, 80, 80, 80]} label="Loading history" />;

  if (weeks.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-20" />
        <p>No ODR history yet. Start entering weekly data in the ODR tab.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Weekly TDR & LDR by account</CardTitle>
          <CardDescription>
            TDR threshold: 0.5% (red) · LDR threshold: 3% (red)
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background z-10 border-r border-border/30">Week</TableHead>
                  {accounts.flatMap(acc => [
                    <TableHead key={`${acc.code}-tdr`} className="text-right text-xs">{acc.code} TDR%</TableHead>,
                    <TableHead key={`${acc.code}-ldr`} className="text-right text-xs">{acc.code} LDR%</TableHead>,
                  ])}
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeks.map(({ key, year, week }) => {
                  const weekRows = odrData.filter(r => r.year === year && r.week_number === week);
                  const anyBreach = weekRows.some(r => {
                    const tdr = (r.cos_pct ?? 0) + (r.ccwsr_pct ?? 0);
                    return tdr > 0.5 || (r.ldr_pct ?? 0) > 3;
                  });
                  return (
                    <TableRow key={key} className={anyBreach ? "bg-destructive/5" : ""}>
                      <TableCell className="sticky left-0 bg-background border-r border-border/30 font-mono text-sm font-semibold">
                        {year}-W{String(week).padStart(2, "0")}
                        {anyBreach && <AlertTriangle className="h-3 w-3 text-destructive inline ml-1" />}
                      </TableCell>
                      {accounts.flatMap(acc => {
                        const r = weekRows.find(row => row.ebay_accounts?.code === acc.code);
                        const tdr = r ? (r.cos_pct ?? 0) + (r.ccwsr_pct ?? 0) : null;
                        return [
                          <TableCell key={`${acc.code}-tdr`} className="text-right">
                            <TierCell value={tdr != null ? Number(tdr.toFixed(4)) : null} tier={tdrTier(tdr)} />
                          </TableCell>,
                          <TableCell key={`${acc.code}-ldr`} className="text-right">
                            <TierCell value={r?.ldr_pct ?? null} tier={ldrTier(r?.ldr_pct ?? null)} />
                          </TableCell>,
                        ];
                      })}
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
}

// ═════════════════════════════════════════════════════════════════
// Graphs Tab — trends + linear-regression projections
// ═════════════════════════════════════════════════════════════════

const ACCOUNT_COLORS: Record<string, string> = {
  ASC: "#3b82f6", // blue
  CPI: "#10b981", // emerald
  "123": "#f59e0b", // amber
  TSS: "#ef4444", // red
  UNI: "#a855f7", // purple
};
const FALLBACK_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899"];

// Ordinary least-squares slope/intercept over [{x,y}], ignoring nulls.
function linReg(points: { x: number; y: number | null }[]) {
  const pts = points.filter(p => p.y != null) as { x: number; y: number }[];
  const n = pts.length;
  if (n < 2) return null;
  const sx = pts.reduce((a, p) => a + p.x, 0);
  const sy = pts.reduce((a, p) => a + p.y, 0);
  const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
  const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function GraphsTab() {
  const [metric, setMetric] = useState<"tdr" | "ldr">("tdr");

  const { data: accounts = [] } = useQuery({
    queryKey: ["ebay-accounts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("ebay_accounts").select("*").eq("active", true).order("sort_order");
      if (error) throw error;
      return data as EbayAccount[];
    },
  });

  const { data: odr = [], isLoading: odrLoading } = useQuery({
    queryKey: ["ebay-odr-graph"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ebay_odr_with_tdr")
        .select("*, ebay_accounts(code)")
        .order("year", { ascending: true })
        .order("week_number", { ascending: true })
        .limit(500);
      if (error) throw error;
      return data as (OdrRow & { ebay_accounts: { code: string } })[];
    },
  });

  const { data: rt = [], isLoading: rtLoading } = useQuery({
    queryKey: ["ebay-rt-graph"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("ebay_response_times")
        .select("*")
        .order("date", { ascending: true })
        .limit(365);
      if (error) throw error;
      return data as ResponseTime[];
    },
  });

  // ── Build ODR chart data: one row per week, a column per account + projection ──
  const PROJECT_WEEKS = 4;
  const odrChart = useMemo(() => {
    const codes = accounts.map(a => a.code);
    // ordered unique weeks
    const weekKeys: { key: string; year: number; week: number }[] = [];
    const seen = new Set<string>();
    for (const r of odr) {
      const key = `${r.year}-W${String(r.week_number).padStart(2, "0")}`;
      if (!seen.has(key)) { seen.add(key); weekKeys.push({ key, year: r.year, week: r.week_number }); }
    }
    const valueOf = (r: OdrRow) => metric === "tdr"
      ? (r.tdr_pct ?? (r.cos_pct ?? 0) + (r.ccwsr_pct ?? 0))
      : (r.ldr_pct ?? null);

    const base = weekKeys.map((wk, i) => {
      const row: any = { idx: i, label: wk.key.replace(/^\d+-/, "") };
      for (const code of codes) {
        const match = odr.find(r => r.year === wk.year && r.week_number === wk.week && r.ebay_accounts?.code === code);
        row[code] = match ? Number(valueOf(match)?.toFixed?.(4) ?? valueOf(match)) : null;
      }
      return row;
    });

    // Per-account linear projection appended as future weeks
    const projections: Record<string, { slope: number; intercept: number } | null> = {};
    for (const code of codes) {
      projections[code] = linReg(base.map(r => ({ x: r.idx, y: r[code] ?? null })));
    }
    const lastWeek = weekKeys[weekKeys.length - 1];
    const future = Array.from({ length: PROJECT_WEEKS }, (_, k) => {
      const i = base.length + k;
      const wnum = (lastWeek?.week ?? 0) + k + 1;
      const row: any = { idx: i, label: `W${String(wnum).padStart(2, "0")}*`, projected: true };
      for (const code of codes) {
        const p = projections[code];
        row[`${code}_proj`] = p ? Math.max(0, Number((p.slope * i + p.intercept).toFixed(4))) : null;
      }
      return row;
    });

    // Bridge: last real point also seeds the projection line so it connects
    if (base.length > 0) {
      const lastIdx = base.length - 1;
      for (const code of codes) {
        const p = projections[code];
        (base[lastIdx] as any)[`${code}_proj`] = p ? Math.max(0, Number((p.slope * lastIdx + p.intercept).toFixed(4))) : base[lastIdx][code];
      }
    }
    return [...base, ...future];
  }, [odr, accounts, metric]);

  // ── Response times chart with projection ──
  const rtChart = useMemo(() => {
    const base = rt.map((r, i) => ({
      idx: i,
      label: r.date.slice(5), // MM-DD
      "7-day": r.open_7d,
      "14-day": r.open_14d,
      "30-day": r.open_30d,
    }));
    const proj = linReg(base.map(r => ({ x: r.idx, y: r["7-day"] ?? null })));
    if (proj && base.length > 0) {
      const lastIdx = base.length - 1;
      (base[lastIdx] as any)["7-day proj"] = Math.max(0, Math.round(proj.slope * lastIdx + proj.intercept));
      const future = Array.from({ length: 7 }, (_, k) => {
        const i = base.length + k;
        return { idx: i, label: `+${k + 1}d`, "7-day proj": Math.max(0, Math.round(proj.slope * i + proj.intercept)), projected: true } as any;
      });
      return [...base, ...future];
    }
    return base;
  }, [rt]);

  const threshold = metric === "tdr" ? 0.5 : 3;
  const colorFor = (code: string, i: number) => ACCOUNT_COLORS[code] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];

  if (odrLoading || rtLoading) return <PageLoader rows={6} columns={[80, 80, 80, 80]} label="Loading graphs" />;

  return (
    <div className="space-y-6">
      {/* ODR trend */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-pd-accent" />
                {metric === "tdr" ? "Total Defect Rate" : "Late Despatch Rate"} by account
              </CardTitle>
              <CardDescription>
                Solid = actual, dashed = {PROJECT_WEEKS}-week linear projection. Red line = eBay limit ({threshold}%).
              </CardDescription>
            </div>
            <Select value={metric} onValueChange={v => setMetric(v as "tdr" | "ldr")}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tdr">TDR (limit 0.5%)</SelectItem>
                <SelectItem value="ldr">LDR (limit 3%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {odrChart.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No ODR data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={odrChart} margin={{ top: 10, right: 16, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} unit="%" />
                <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={threshold} stroke="hsl(var(--destructive))" strokeDasharray="4 4" label={{ value: `Limit ${threshold}%`, fontSize: 10, fill: "hsl(var(--destructive))", position: "insideTopRight" }} />
                {accounts.map((a, i) => (
                  <Line key={a.code} type="monotone" dataKey={a.code} stroke={colorFor(a.code, i)} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                ))}
                {accounts.map((a, i) => (
                  <Line key={`${a.code}_proj`} type="monotone" dataKey={`${a.code}_proj`} stroke={colorFor(a.code, i)} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls legendType="none" />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Response times trend */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-pd-accent" />
            Response times trend
          </CardTitle>
          <CardDescription>Open message backlog (7/14/30-day windows). Dashed = 7-day projection.</CardDescription>
        </CardHeader>
        <CardContent>
          {rtChart.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No response time data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={rtChart} margin={{ top: 10, right: 16, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} />
                <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={12} stroke="hsl(var(--warning))" strokeDasharray="4 4" label={{ value: "Watch (12)", fontSize: 10, fill: "hsl(var(--warning))", position: "insideTopRight" }} />
                <Line type="monotone" dataKey="7-day" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                <Line type="monotone" dataKey="14-day" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                <Line type="monotone" dataKey="30-day" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                <Line type="monotone" dataKey="7-day proj" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls legendType="none" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Projections are a simple least-squares trend of the historical points — directional guidance, not a forecast. A rising dashed line toward a red limit is an early warning.
      </p>
    </div>
  );
}
