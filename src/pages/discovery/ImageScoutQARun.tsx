import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Beaker, RefreshCw, Download, Play, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type Run = {
  id: string;
  label: string;
  notes: string | null;
  sku_count: number;
  status: string;
  summary: any;
  created_at: string;
  completed_at: string | null;
};

type Item = {
  id: string;
  run_id: string;
  sku: string;
  brand: string | null;
  part_number: string | null;
  job_id: string | null;
  candidate_id: string | null;
  best_candidate_url: string | null;
  source_domain: string | null;
  confidence_score: number | null;
  candidates_found: number;
  status: string | null;
  processing_status: string | null;
  processed_storage_path: string | null;
  safety_flags: string[];
  job_outcome: string | null;
};

const PROCESSED_BUCKET = "image-scout-processed";

export default function ImageScoutQARun() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [skusText, setSkusText] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const runsQ = useQuery({
    queryKey: ["qa-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("image_scout_qa_runs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Run[];
    },
  });

  const itemsQ = useQuery({
    queryKey: ["qa-run-items", activeRunId],
    queryFn: async () => {
      if (!activeRunId) return [] as Item[];
      const { data, error } = await supabase
        .from("image_scout_qa_run_items" as any)
        .select("*")
        .eq("run_id", activeRunId)
        .order("sku");
      if (error) throw error;
      return (data ?? []) as unknown as Item[];
    },
    enabled: !!activeRunId,
    refetchInterval: (q) => {
      const run = (runsQ.data ?? []).find((r) => r.id === activeRunId);
      return run?.status === "running" ? 4000 : false;
    },
  });

  const parsedSkus = useMemo(
    () => Array.from(new Set(skusText.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean))),
    [skusText],
  );

  const startRun = useMutation({
    mutationFn: async () => {
      if (parsedSkus.length < 1) throw new Error("Add at least 1 SKU");
      if (parsedSkus.length > 100) throw new Error("Max 100 SKUs per QA run");

      // 1. Create the run
      const { data: { user } } = await supabase.auth.getUser();
      const { data: run, error: rErr } = await supabase
        .from("image_scout_qa_runs" as any)
        .insert({
          label: label || `QA run · ${new Date().toLocaleString()}`,
          notes: notes || null,
          sku_count: parsedSkus.length,
          status: "running",
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (rErr) throw rErr;
      const runId = (run as any).id as string;

      // 2. Look up brand info best-effort
      const { data: products } = await supabase
        .from("products_cache")
        .select("sku, brand_id, brands:brand_id(name, prefix)")
        .in("sku", parsedSkus);
      const meta = new Map<string, { brand: string | null; part: string | null }>();
      for (const p of (products ?? []) as any[]) {
        const brandName = p.brands?.name ?? null;
        const prefix = p.brands?.prefix ?? null;
        let part: string | null = null;
        if (prefix && p.sku) {
          const sep = p.sku.includes("/") ? "/" : "-";
          const expected = `${prefix}${sep}`;
          if (p.sku.toUpperCase().startsWith(expected.toUpperCase())) {
            part = p.sku.slice(expected.length);
          }
        }
        meta.set(p.sku, { brand: brandName, part });
      }

      // 3. Queue jobs and seed items
      for (const sku of parsedSkus) {
        const m = meta.get(sku) ?? { brand: null, part: null };
        const { data: job, error: jErr } = await supabase
          .from("image_scout_jobs")
          .insert({ sku, mode: "targeted" })
          .select("id")
          .single();
        if (jErr) continue;
        await supabase.from("image_scout_qa_run_items" as any).insert({
          run_id: runId,
          sku,
          brand: m.brand,
          part_number: m.part,
          job_id: (job as any).id,
        });
        // Fire processing (async, non-blocking)
        supabase.functions.invoke("image-scout-process", {
          body: { job_id: (job as any).id },
        }).catch(() => { /* tracked via job status */ });
      }

      return runId;
    },
    onSuccess: (runId) => {
      toast.success(`QA run started for ${parsedSkus.length} SKUs`);
      setLabel(""); setNotes(""); setSkusText("");
      setActiveRunId(runId);
      qc.invalidateQueries({ queryKey: ["qa-runs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const refreshRun = useMutation({
    mutationFn: async (runId: string) => {
      // Pull latest job/candidate/processing state for each item.
      const { data: items } = await supabase
        .from("image_scout_qa_run_items" as any).select("*").eq("run_id", runId);
      const arr = (items ?? []) as unknown as Item[];
      if (!arr.length) return;

      const jobIds = arr.map((i) => i.job_id).filter(Boolean) as string[];
      const skus = arr.map((i) => i.sku);

      const [{ data: jobs }, { data: candAll }, { data: approved }] = await Promise.all([
        supabase.from("image_scout_jobs").select("id, sku, status, error").in("id", jobIds),
        supabase.from("image_scout_candidates" as any)
          .select("id, sku, image_url, source_domain, confidence_score, status, picked, created_at")
          .in("sku", skus),
        supabase.from("approved_product_images" as any)
          .select("id, sku, candidate_id, processing_status, processed_storage_path, safety_flags")
          .in("sku", skus),
      ]);

      const jobMap = new Map((jobs ?? []).map((j: any) => [j.id, j]));

      // Best candidate per SKU (highest confidence; prefer picked)
      const bySku = new Map<string, any[]>();
      for (const c of (candAll ?? []) as any[]) {
        const list = bySku.get(c.sku) ?? [];
        list.push(c);
        bySku.set(c.sku, list);
      }
      const approvedBySku = new Map<string, any>();
      for (const a of (approved ?? []) as any[]) approvedBySku.set(a.sku, a);

      for (const it of arr) {
        const job = it.job_id ? (jobMap.get(it.job_id) as any) : null;
        const cands = bySku.get(it.sku) ?? [];
        const best = cands.sort((a, b) => {
          if (a.picked !== b.picked) return a.picked ? -1 : 1;
          return (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
        })[0];
        const ap = approvedBySku.get(it.sku);
        const jobOutcome = !job ? null
          : job.status === "success" ? (cands.length ? "success" : "no_candidate")
          : job.status === "failed" ? "failed"
          : job.status;

        await supabase.from("image_scout_qa_run_items" as any).update({
          candidate_id: best?.id ?? null,
          best_candidate_url: best?.image_url ?? null,
          source_domain: best?.source_domain ?? null,
          confidence_score: best?.confidence_score ?? null,
          candidates_found: cands.length,
          status: best?.status ?? null,
          processing_status: ap?.processing_status ?? null,
          processed_storage_path: ap?.processed_storage_path ?? null,
          safety_flags: ap?.safety_flags ?? [],
          job_outcome: jobOutcome,
        }).eq("id", it.id);
      }

      // Recompute summary
      const fresh = await supabase.from("image_scout_qa_run_items" as any)
        .select("*").eq("run_id", runId);
      const items2 = ((fresh.data ?? []) as unknown) as Item[];
      const summary = computeSummary(items2);
      const allDone = items2.every((i) => i.job_outcome && i.job_outcome !== "running" && i.job_outcome !== "queued");
      await supabase.from("image_scout_qa_runs" as any).update({
        summary,
        status: allDone ? "completed" : "running",
        completed_at: allDone ? new Date().toISOString() : null,
      }).eq("id", runId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["qa-runs"] });
      qc.invalidateQueries({ queryKey: ["qa-run-items"] });
      toast.success("Run refreshed");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateNotes = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase
        .from("image_scout_qa_runs" as any)
        .update({ notes }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qa-runs"] }),
  });

  const activeRun = (runsQ.data ?? []).find((r) => r.id === activeRunId);
  const summary = activeRun?.summary ?? null;

  const exportCsv = () => {
    const rows = (itemsQ.data ?? []).map((i) => ({
      sku: i.sku,
      brand: i.brand ?? "",
      part_number: i.part_number ?? "",
      best_candidate_url: i.best_candidate_url ?? "",
      confidence_score: i.confidence_score ?? "",
      status: i.status ?? "",
      processing_status: i.processing_status ?? "",
      safety_flags: (i.safety_flags ?? []).join("|"),
      processed_image_url: i.processed_storage_path
        ? supabase.storage.from(PROCESSED_BUCKET).getPublicUrl(i.processed_storage_path).data.publicUrl
        : "",
    }));
    const cols = Object.keys(rows[0] ?? { sku: "" });
    const csv = [
      cols.join(","),
      ...rows.map((r) => cols.map((c) =>
        `"${String((r as any)[c]).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qa_run_${activeRun?.label ?? activeRunId}.csv`.replace(/[^\w.-]+/g, "_");
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Beaker className="h-6 w-6 text-primary" />
            Image Scout — QA Run
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Process a controlled batch of SKUs end-to-end, then review quality, cost, and failure patterns before scaling.
          </p>
        </div>
        <Button variant="ghost" onClick={() => navigate("/discovery/image-scout")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Image Scout
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Start a new QA run</CardTitle>
            <CardDescription>25–100 SKUs recommended</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Brake pads sample 50" />
            </div>
            <div>
              <Label>SKUs ({parsedSkus.length})</Label>
              <Textarea
                rows={8}
                value={skusText}
                onChange={(e) => setSkusText(e.target.value)}
                placeholder="Paste SKUs (newline / comma / space separated)"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button
              onClick={() => startRun.mutate()}
              disabled={startRun.isPending || parsedSkus.length < 1 || parsedSkus.length > 100}
              className="w-full"
            >
              <Play className="h-4 w-4 mr-1" /> Start QA run
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Past QA runs</CardTitle>
            <CardDescription>Click a run to view items and metrics</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>SKUs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runsQ.data ?? []).map((r) => (
                  <TableRow key={r.id} onClick={() => setActiveRunId(r.id)}
                    className={`cursor-pointer ${activeRunId === r.id ? "bg-muted/50" : ""}`}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell>{r.sku_count}</TableCell>
                    <TableCell><Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {!runsQ.data?.length && (
                  <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">No QA runs yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {activeRun && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">{activeRun.label}</CardTitle>
              <CardDescription>{activeRun.sku_count} SKUs · {activeRun.status}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => refreshRun.mutate(activeRun.id)} disabled={refreshRun.isPending}>
                <RefreshCw className={`h-4 w-4 mr-1 ${refreshRun.isPending ? "animate-spin" : ""}`} /> Refresh metrics
              </Button>
              <Button size="sm" variant="outline" onClick={exportCsv} disabled={!itemsQ.data?.length}>
                <Download className="h-4 w-4 mr-1" /> Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Notes */}
            <div>
              <Label>Batch notes</Label>
              <Textarea
                rows={2}
                defaultValue={activeRun.notes ?? ""}
                onBlur={(e) => {
                  if (e.target.value !== (activeRun.notes ?? ""))
                    updateNotes.mutate({ id: activeRun.id, notes: e.target.value });
                }}
              />
            </div>

            {/* Summary */}
            <SummaryGrid summary={summary ?? computeSummary(itemsQ.data ?? [])} total={activeRun.sku_count} />

            {/* Items */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Part #</TableHead>
                    <TableHead>Cands</TableHead>
                    <TableHead>Conf</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Processing</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(itemsQ.data ?? []).map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono text-xs">{i.sku}</TableCell>
                      <TableCell className="text-xs">{i.brand ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{i.part_number ?? "—"}</TableCell>
                      <TableCell>{i.candidates_found}</TableCell>
                      <TableCell>{i.confidence_score != null ? Number(i.confidence_score).toFixed(0) : "—"}</TableCell>
                      <TableCell className="text-xs">{i.source_domain ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{i.job_outcome ?? "—"}</Badge></TableCell>
                      <TableCell><Badge variant="outline">{i.status ?? "—"}</Badge></TableCell>
                      <TableCell><Badge variant="outline">{i.processing_status ?? "—"}</Badge></TableCell>
                      <TableCell className="text-xs">{(i.safety_flags ?? []).join(", ") || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {!itemsQ.data?.length && (
                    <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-6">No items yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------- Summary helpers ----------

function computeSummary(items: Item[]) {
  const total = items.length;
  const candidatesFound = items.filter((i) => i.candidates_found > 0).length;
  const noCandidate = items.filter((i) => i.job_outcome === "no_candidate").length;
  const failed = items.filter((i) => i.job_outcome === "failed").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const processed = items.filter((i) => i.processing_status === "completed").length;
  const procFailed = items.filter((i) => i.processing_status === "failed").length;
  const manual = items.filter((i) => i.processing_status === "manual_required").length;

  const confs = items.map((i) => Number(i.confidence_score)).filter((n) => Number.isFinite(n));
  const avgConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;

  const domainOk = new Map<string, number>();
  const domainBad = new Map<string, number>();
  const flagCounts = new Map<string, number>();
  for (const i of items) {
    if (i.source_domain) {
      if (i.candidates_found > 0) domainOk.set(i.source_domain, (domainOk.get(i.source_domain) ?? 0) + 1);
    }
    if (i.job_outcome === "failed" || i.job_outcome === "no_candidate") {
      const d = i.source_domain ?? "(none)";
      domainBad.set(d, (domainBad.get(d) ?? 0) + 1);
    }
    for (const f of i.safety_flags ?? []) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ k, v }));

  return {
    total, candidatesFound, noCandidate, failed,
    approved, processed, procFailed, manual,
    avgConf: Math.round(avgConf * 10) / 10,
    topOk: top(domainOk),
    topBad: top(domainBad),
    topFlags: top(flagCounts),
  };
}

function SummaryGrid({ summary, total }: { summary: any; total: number }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total processed" value={summary.total ?? total} />
        <Stat label="Candidates found" value={summary.candidatesFound ?? 0} />
        <Stat label="No candidate" value={summary.noCandidate ?? 0} />
        <Stat label="Avg confidence" value={summary.avgConf ?? 0} />
        <Stat label="Approved" value={summary.approved ?? 0} />
        <Stat label="Processed (done)" value={summary.processed ?? 0} />
        <Stat label="Manual required" value={summary.manual ?? 0} />
        <Stat label="Failed processing" value={summary.procFailed ?? 0} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <RankList title="Top successful domains" rows={summary.topOk ?? []} />
        <RankList title="Top failing domains" rows={summary.topBad ?? []} />
        <RankList title="Most common warnings" rows={summary.topFlags ?? []} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground uppercase">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function RankList({ title, rows }: { title: string; rows: { k: string; v: number }[] }) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground uppercase mb-2">{title}</div>
      {!rows.length && <div className="text-xs text-muted-foreground">—</div>}
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.k} className="flex justify-between">
            <span className="truncate mr-2">{r.k}</span>
            <span className="text-muted-foreground">{r.v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
