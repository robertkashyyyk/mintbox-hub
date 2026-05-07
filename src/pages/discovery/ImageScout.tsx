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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sparkles, Play, RefreshCw, ListChecks, AlertCircle, ImageIcon, History, RotateCw, Trash2, Target, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { getProductImageUrl } from "@/lib/imageUrl";

type Brand = { id: string; name: string };
type MissingRow = { sku: string; name: string | null; brand_id: string | null };
type Job = {
  id: string;
  sku: string;
  brand_id: string | null;
  mode: "targeted" | "open_search";
  status: string;
  source_url: string | null;
  override_search_term: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};
type Result = {
  id: string;
  sku: string;
  outcome: string;
  source_page_url: string | null;
  source_image_url: string | null;
  raw_width: number | null;
  raw_height: number | null;
  storage_path: string | null;
  notes: string | null;
  created_at: string;
};

export default function ImageScout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [mode, setMode] = useState<"targeted" | "open_search">("targeted");
  const [skuInput, setSkuInput] = useState("");
  const [bulkSkus, setBulkSkus] = useState("");
  const [supplierUrl, setSupplierUrl] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [tab, setTab] = useState<string>("run");
  const [logStatusFilter, setLogStatusFilter] = useState<string | null>(null);

  const brandsQ = useQuery({
    queryKey: ["brands-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("id, name").order("name");
      if (error) throw error;
      return data as Brand[];
    },
  });

  // Missing-images queue: products_cache without a corresponding storage object.
  // We approximate via a server-side filter on a known signal: storage object existence is checked separately.
  // For now: list products_cache whose sku doesn't have an entry in storage.objects (use rpc-less heuristic via list).
  const missingQ = useQuery({
    queryKey: ["image-scout-missing", brandFilter],
    queryFn: async () => {
      let q = supabase
        .from("products_cache")
        .select("sku, name, brand_id")
        .order("sku")
        .limit(500);
      if (brandFilter !== "all") q = q.eq("brand_id", brandFilter);
      const { data, error } = await q;
      if (error) throw error;
      // Cross-check against bucket: list objects (single page; flat naming sku.{ext})
      const { data: objs } = await supabase.storage.from("product-images").list("", { limit: 1000 });
      const have = new Set((objs ?? []).map((o) => o.name.replace(/\.[a-z0-9]+$/i, "")));
      return (data as MissingRow[]).filter((r) => !have.has(r.sku));
    },
  });

  const jobsQ = useQuery({
    queryKey: ["image-scout-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("image_scout_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as Job[];
    },
    refetchInterval: 5000,
  });

  const resultsQ = useQuery({
    queryKey: ["image-scout-results"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("image_scout_results")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as Result[];
    },
    refetchInterval: 5000,
  });

  const reviewQ = useQuery({
    queryKey: ["image-scout-review"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("image_scout_results")
        .select("*")
        .in("outcome", ["watermark_review", "low_res"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Result[];
    },
  });

  const candidatesQ = useQuery({
    queryKey: ["image-scout-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("image_scout_candidates")
        .select("*")
        .order("created_at", { ascending: false })
        .order("confidence_score", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 10000,
  });

  const enqueue = useMutation({
    mutationFn: async (payload: { skus: string[]; runNow: boolean }) => {
      const rows = payload.skus.map((sku) => {
        const brand_id =
          missingQ.data?.find((r) => r.sku === sku)?.brand_id ??
          (brandFilter !== "all" ? brandFilter : null);
        return {
          sku,
          brand_id,
          mode,
          source_url: mode === "targeted" && supplierUrl ? supplierUrl : null,
          override_search_term: mode === "open_search" && searchTerm ? searchTerm : null,
        };
      });
      const { data, error } = await supabase
        .from("image_scout_jobs")
        .insert(rows)
        .select("id");
      if (error) throw error;
      if (payload.runNow && data?.[0]) {
        // Process the first one synchronously
        const { error: invErr } = await supabase.functions.invoke("image-scout-process", {
          body: { job_id: data[0].id },
        });
        if (invErr) throw invErr;
      }
      return data?.length ?? 0;
    },
    onSuccess: (n, vars) => {
      toast.success(`Queued ${n} job${n === 1 ? "" : "s"}${vars.runNow ? " — first one processed now" : ""}`);
      setSkuInput("");
      setBulkSkus("");
      qc.invalidateQueries({ queryKey: ["image-scout-jobs"] });
      qc.invalidateQueries({ queryKey: ["image-scout-results"] });
      qc.invalidateQueries({ queryKey: ["image-scout-missing"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const review = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("image_scout_results")
        .update({ outcome: action, reviewed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["image-scout-review"] });
      qc.invalidateQueries({ queryKey: ["image-scout-results"] });
    },
  });

  const retryJob = useMutation({
    mutationFn: async (job: Job) => {
      const { data, error } = await supabase
        .from("image_scout_jobs")
        .insert({
          sku: job.sku,
          brand_id: job.brand_id,
          mode: job.mode,
          source_url: job.source_url,
          override_search_term: job.override_search_term,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: invErr } = await supabase.functions.invoke("image-scout-process", {
        body: { job_id: data.id },
      });
      if (invErr) throw invErr;
    },
    onSuccess: () => {
      toast.success("Retry queued and processed");
      qc.invalidateQueries({ queryKey: ["image-scout-jobs"] });
      qc.invalidateQueries({ queryKey: ["image-scout-results"] });
      qc.invalidateQueries({ queryKey: ["image-scout-review"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteJob = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("image_scout_jobs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Job deleted");
      qc.invalidateQueries({ queryKey: ["image-scout-jobs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const stats = useMemo(() => {
    const j = jobsQ.data ?? [];
    return {
      queued: j.filter((x) => x.status === "queued").length,
      running: j.filter((x) => x.status === "running").length,
      success: j.filter((x) => x.status === "success").length,
      failed: j.filter((x) => x.status === "failed").length,
      review: j.filter((x) => x.status === "needs_review").length,
    };
  }, [jobsQ.data]);

  const skusFromBulk = bulkSkus.split(/[\s,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const singleSku = skuInput.trim();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Image Scout
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Find, process, and store product images for SKUs that are missing them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/discovery/image-scout/brand-profiles")}>
            <SettingsIcon className="h-4 w-4 mr-1" /> Brand Profiles
          </Button>
          <Button variant="ghost" onClick={() => navigate("/discovery")}>← Discovery</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Queued" value={stats.queued} onClick={() => { setLogStatusFilter("queued"); setTab("log"); }} />
        <StatCard label="Running" value={stats.running} onClick={() => { setLogStatusFilter("running"); setTab("log"); }} />
        <StatCard label="Success" value={stats.success} onClick={() => { setLogStatusFilter("success"); setTab("log"); }} />
        <StatCard label="Failed" value={stats.failed} onClick={() => { setLogStatusFilter("failed"); setTab("log"); }} />
        <StatCard label="Needs Review" value={stats.review} onClick={() => { setLogStatusFilter("needs_review"); setTab("log"); }} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="run"><Play className="h-4 w-4 mr-1" /> Run Agent</TabsTrigger>
          <TabsTrigger value="queue"><ListChecks className="h-4 w-4 mr-1" /> Missing Images ({missingQ.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="review"><AlertCircle className="h-4 w-4 mr-1" /> Needs Review ({reviewQ.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="log"><History className="h-4 w-4 mr-1" /> Job Log</TabsTrigger>
        </TabsList>

        <TabsContent value="run">
          <Card>
            <CardHeader>
              <CardTitle>Run the agent</CardTitle>
              <CardDescription>
                Choose a mode, paste SKUs, and either run a single SKU now or queue a batch (background worker processes one job every 5 minutes).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mode</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="targeted">Mode 1 — Targeted (supplier URL / brand pattern + Firecrawl fallback)</SelectItem>
                      <SelectItem value="open_search">Mode 2 — Open Internet Search (Google CSE)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Brand filter (used for derivation)</Label>
                  <Select value={brandFilter} onValueChange={setBrandFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All brands</SelectItem>
                      {brandsQ.data?.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {mode === "targeted" && (
                <div className="space-y-2">
                  <Label>Supplier product page URL (optional — overrides brand pattern)</Label>
                  <Input value={supplierUrl} onChange={(e) => setSupplierUrl(e.target.value)} placeholder="https://supplier.example.com/product/{sku}" />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to use the brand's <code>image_url_pattern</code>; if neither is set, the agent will fall back to a Firecrawl search on the brand's <code>image_search_domain</code>.
                  </p>
                </div>
              )}

              {mode === "open_search" && (
                <div className="space-y-2">
                  <Label>Search term override (optional — defaults to "{`{brand} {sku}`}")</Label>
                  <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="e.g. Bosch GSR 18V drill" />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Single SKU — Run now</Label>
                  <div className="flex gap-2">
                    <Input value={skuInput} onChange={(e) => setSkuInput(e.target.value)} placeholder="HOL-GG8RA" />
                    <Button
                      disabled={!singleSku || enqueue.isPending}
                      onClick={() => enqueue.mutate({ skus: [singleSku], runNow: true })}
                    >
                      <Play className="h-4 w-4 mr-1" /> Run now
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Batch — Queue for background</Label>
                  <Textarea
                    rows={4}
                    value={bulkSkus}
                    onChange={(e) => setBulkSkus(e.target.value)}
                    placeholder="One SKU per line, or comma/space separated"
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">{skusFromBulk.length} SKUs</span>
                    <Button
                      disabled={!skusFromBulk.length || enqueue.isPending}
                      onClick={() => enqueue.mutate({ skus: skusFromBulk, runNow: false })}
                      variant="secondary"
                    >
                      Queue {skusFromBulk.length}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="queue">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>SKUs missing images</CardTitle>
                <CardDescription>
                  Filter by brand; tick any to enqueue, or run an entire brand at once.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => missingQ.refetch()}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                </Button>
                <Button
                  size="sm"
                  disabled={!missingQ.data?.length || enqueue.isPending}
                  onClick={() => enqueue.mutate({ skus: (missingQ.data ?? []).map((r) => r.sku), runNow: false })}
                >
                  Queue all ({missingQ.data?.length ?? 0})
                </Button>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {missingQ.data?.slice(0, 200).map((r) => (
                    <TableRow key={r.sku}>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell className="text-sm">{r.name ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => enqueue.mutate({ skus: [r.sku], runNow: true })}
                        >
                          <Play className="h-3 w-3 mr-1" /> Run
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {missingQ.data && missingQ.data.length > 200 && (
                <p className="text-xs text-muted-foreground mt-2">Showing 200 of {missingQ.data.length}.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review">
          <Card>
            <CardHeader>
              <CardTitle>Needs review</CardTitle>
              <CardDescription>Images flagged for possible watermarks or low quality.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {reviewQ.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing to review.</p>
              )}
              {reviewQ.data?.map((r) => {
                const job = jobsQ.data?.find((j) => j.sku === r.sku);
                return (
                <Card key={r.id}>
                  <CardContent className="p-3 space-y-2">
                    <div className="aspect-square w-full bg-muted rounded overflow-hidden flex items-center justify-center">
                      {r.source_image_url ? (
                        <img src={r.source_image_url} alt={r.sku} className="object-contain h-full w-full" />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                    <div className="text-xs font-mono">{r.sku}</div>
                    <Badge variant="outline" className="text-xs">{r.outcome}</Badge>
                    {r.raw_width && r.raw_height && (
                      <div className="text-xs text-muted-foreground">{r.raw_width}×{r.raw_height}px</div>
                    )}
                    <div className="text-xs text-muted-foreground truncate">{r.notes}</div>
                    {r.source_page_url && (
                      <a href={r.source_page_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline truncate block">
                        Source page
                      </a>
                    )}
                    {r.source_image_url && (
                      <a href={r.source_image_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline truncate block">
                        Open full image
                      </a>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" onClick={() => review.mutate({ id: r.id, action: "approved" })}>Approve</Button>
                      <Button size="sm" variant="destructive" onClick={() => review.mutate({ id: r.id, action: "rejected" })}>Reject</Button>
                      {job && (
                        <Button size="sm" variant="outline" onClick={() => retryJob.mutate(job)} disabled={retryJob.isPending}>
                          <RotateCw className="h-3 w-3 mr-1" /> Retry
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="log">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent jobs & results</CardTitle>
                <CardDescription>
                  Live (refreshes every 5s).{logStatusFilter ? ` Filtered: ${logStatusFilter}` : ""}
                </CardDescription>
              </div>
              {logStatusFilter && (
                <Button size="sm" variant="ghost" onClick={() => setLogStatusFilter(null)}>Clear filter</Button>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Stored</TableHead>
                    <TableHead>Notes / Error</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobsQ.data?.filter((j) => !logStatusFilter || j.status === logStatusFilter).map((j) => {
                    const r = resultsQ.data?.find((x) => x.sku === j.sku && (!j.finished_at || new Date(x.created_at) >= new Date(j.created_at)));
                    const canAct = j.status === "failed" || j.status === "needs_review" || j.status === "success";
                    return (
                      <TableRow key={j.id}>
                        <TableCell className="text-xs">{new Date(j.created_at).toLocaleString()}</TableCell>
                        <TableCell className="font-mono text-xs">{j.sku}</TableCell>
                        <TableCell><Badge variant="outline">{j.mode}</Badge></TableCell>
                        <TableCell><StatusBadge status={j.status} /></TableCell>
                        <TableCell>{r?.outcome ?? "—"}</TableCell>
                        <TableCell>
                          {r?.storage_path ? (
                            <a href={getProductImageUrl(j.sku, "png")} target="_blank" rel="noreferrer">
                              <img src={getProductImageUrl(j.sku, "png")} alt={j.sku} className="h-10 w-10 object-contain bg-muted rounded" />
                            </a>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-md whitespace-pre-wrap break-words">
                          {j.error || r?.notes || ""}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {canAct && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={retryJob.isPending}
                                onClick={() => retryJob.mutate(j)}
                                title="Retry"
                              >
                                <RotateCw className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={deleteJob.isPending}
                              onClick={() => deleteJob.mutate(j.id)}
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  return (
    <Card
      onClick={onClick}
      className={onClick ? "cursor-pointer hover:border-primary transition-colors" : undefined}
    >
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: "secondary",
    running: "default",
    success: "default",
    failed: "destructive",
    needs_review: "outline",
  };
  return <Badge variant={(map[status] ?? "outline") as any}>{status}</Badge>;
}
