import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, BarChart3, RefreshCw, Lightbulb, ShieldCheck, ShieldX } from "lucide-react";
import { toast } from "sonner";

type Candidate = {
  id: string;
  sku: string;
  brand_id: string | null;
  source_domain: string | null;
  image_url: string | null;
  confidence_score: number | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

type Approved = {
  candidate_id: string;
  sku: string;
  processing_status: string;
  safety_flags: string[] | null;
  approved_by: string | null;
};

type Brand = { id: string; name: string };
type Profile = { brand_id: string; preferred_domains: string[]; blocked_domains: string[] };
type Event = { candidate_id: string; action: string; user_id: string | null; created_at: string };
type QaRun = { id: string; label: string; created_at: string; summary: any; sku_count: number; status: string };

const WINDOW_DAYS = 90;
const ROW_CAP = 5000;

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtNum = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "—");

function useCalibrationData() {
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - WINDOW_DAYS);
    return d.toISOString();
  }, []);

  return useQuery({
    queryKey: ["image-scout-calibration", since],
    queryFn: async () => {
      const [candR, apprR, brandR, profileR, eventR, runR] = await Promise.all([
        supabase
          .from("image_scout_candidates")
          .select("id,sku,brand_id,source_domain,image_url,confidence_score,status,created_at,reviewed_at,reviewed_by")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(ROW_CAP),
        supabase
          .from("approved_product_images")
          .select("candidate_id,sku,processing_status,safety_flags,approved_by")
          .gte("created_at", since)
          .limit(ROW_CAP),
        supabase.from("brands").select("id,name"),
        supabase.from("brand_image_profiles").select("brand_id,preferred_domains,blocked_domains"),
        supabase
          .from("image_scout_candidate_events")
          .select("candidate_id,action,user_id,created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(ROW_CAP),
        supabase
          .from("image_scout_qa_runs")
          .select("id,label,created_at,summary,sku_count,status")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      if (candR.error) throw candR.error;
      if (apprR.error) throw apprR.error;
      if (brandR.error) throw brandR.error;
      if (profileR.error) throw profileR.error;
      if (eventR.error) throw eventR.error;
      if (runR.error) throw runR.error;

      return {
        candidates: (candR.data || []) as Candidate[],
        approved: (apprR.data || []) as Approved[],
        brands: (brandR.data || []) as Brand[],
        profiles: (profileR.data || []) as Profile[],
        events: (eventR.data || []) as Event[],
        runs: (runR.data || []) as QaRun[],
      };
    },
  });
}

// ---------- Brand performance ----------
type BrandRow = {
  brand_id: string | null;
  brand_name: string;
  total: number;
  skus: number;
  avgCandidatesPerSku: number;
  avgConfidence: number;
  approvalRate: number;
  manualRate: number;
  noCandidateRate: number;
  processingFailRate: number;
  successRate: number;
};

function computeBrandRows(
  candidates: Candidate[],
  approved: Approved[],
  brands: Brand[],
): BrandRow[] {
  const brandMap = new Map(brands.map((b) => [b.id, b.name]));
  const apprByCand = new Map(approved.map((a) => [a.candidate_id, a]));
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const k = c.brand_id || "__unknown__";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  const rows: BrandRow[] = [];
  for (const [k, list] of groups) {
    const skuSet = new Set(list.map((c) => c.sku));
    const skus = skuSet.size;
    const total = list.length;
    const conf =
      list.reduce((a, c) => a + (Number(c.confidence_score) || 0), 0) / Math.max(total, 1);
    const approvedCount = list.filter((c) => c.status === "approved").length;
    const manualCount = list.filter((c) => c.status === "manual_required").length;
    // No-candidate per SKU: SKUs with zero candidates can't appear here, so this measures SKUs whose best candidate was dismissed/rejected
    const skuStatus = new Map<string, string[]>();
    list.forEach((c) => {
      if (!skuStatus.has(c.sku)) skuStatus.set(c.sku, []);
      skuStatus.get(c.sku)!.push(c.status);
    });
    const noCandSkus = [...skuStatus.values()].filter((arr) =>
      arr.every((s) => s === "dismissed" || s === "rejected"),
    ).length;
    // Processing failures from approved table
    const apprForBrand = list
      .map((c) => apprByCand.get(c.id))
      .filter((a): a is Approved => Boolean(a));
    const procFail = apprForBrand.filter((a) => a.processing_status === "failed").length;
    const procDone = apprForBrand.filter((a) => a.processing_status === "succeeded").length;
    const procTotal = apprForBrand.length;

    rows.push({
      brand_id: k === "__unknown__" ? null : k,
      brand_name: k === "__unknown__" ? "Unknown" : brandMap.get(k) || "—",
      total,
      skus,
      avgCandidatesPerSku: total / Math.max(skus, 1),
      avgConfidence: conf,
      approvalRate: pct(approvedCount, total),
      manualRate: pct(manualCount, total),
      noCandidateRate: pct(noCandSkus, skus),
      processingFailRate: pct(procFail, Math.max(procTotal, 1)),
      successRate: pct(procDone, Math.max(skus, 1)),
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

// ---------- Domain performance ----------
type DomainRow = {
  domain: string;
  total: number;
  avgConfidence: number;
  approvalRate: number;
  rejectRate: number;
  duplicateRate: number;
  packagingRate: number;
  diagramRate: number;
  processingSuccessRate: number;
  status: "preferred" | "blocked" | "neutral";
};

function computeDomainRows(
  candidates: Candidate[],
  approved: Approved[],
  profiles: Profile[],
  brandFilter: string | null,
): DomainRow[] {
  const filtered = brandFilter ? candidates.filter((c) => c.brand_id === brandFilter) : candidates;
  const apprByCand = new Map(approved.map((a) => [a.candidate_id, a]));
  // duplicate detection: image_url repeated across SKUs
  const urlSkus = new Map<string, Set<string>>();
  filtered.forEach((c) => {
    if (!c.source_domain) return;
    const k = c.image_url || c.id;
    if (!urlSkus.has(k)) urlSkus.set(k, new Set());
    urlSkus.get(k)!.add(c.sku);
  });

  const groups = new Map<string, Candidate[]>();
  for (const c of filtered) {
    if (!c.source_domain) continue;
    if (!groups.has(c.source_domain)) groups.set(c.source_domain, []);
    groups.get(c.source_domain)!.push(c);
  }

  const preferred = new Set<string>();
  const blocked = new Set<string>();
  for (const p of profiles) {
    if (brandFilter && p.brand_id !== brandFilter) continue;
    (p.preferred_domains || []).forEach((d) => preferred.add(d));
    (p.blocked_domains || []).forEach((d) => blocked.add(d));
  }

  const rows: DomainRow[] = [];
  for (const [domain, list] of groups) {
    const total = list.length;
    const conf = list.reduce((a, c) => a + (Number(c.confidence_score) || 0), 0) / total;
    const apprList = list.map((c) => apprByCand.get(c.id)).filter((a): a is Approved => Boolean(a));
    const flagsList = apprList.flatMap((a) => a.safety_flags || []);
    const packaging = flagsList.filter((f) => f.includes("packaging")).length;
    const diagram = flagsList.filter((f) => f.includes("diagram")).length;
    const procDone = apprList.filter((a) => a.processing_status === "succeeded").length;
    const status: DomainRow["status"] = blocked.has(domain)
      ? "blocked"
      : preferred.has(domain)
        ? "preferred"
        : "neutral";

    rows.push({
      domain,
      total,
      avgConfidence: conf,
      approvalRate: pct(list.filter((c) => c.status === "approved").length, total),
      rejectRate: pct(
        list.filter((c) => c.status === "rejected" || c.status === "dismissed").length,
        total,
      ),
      duplicateRate: 0, // computed below
      packagingRate: pct(packaging, Math.max(apprList.length, 1)),
      diagramRate: pct(diagram, Math.max(apprList.length, 1)),
      processingSuccessRate: pct(procDone, Math.max(apprList.length, 1)),
      status,
    });
  }
  // duplicate per domain: share of candidates whose image_url appears for >1 SKU
  for (const row of rows) {
    const list = groups.get(row.domain)!;
    const dup = list.filter((c) => {
      const k = c.image_url || c.id;
      return (urlSkus.get(k)?.size || 0) > 1;
    }).length;
    row.duplicateRate = pct(dup, list.length);
  }
  return rows.sort((a, b) => b.total - a.total);
}

// ---------- Calibration buckets ----------
function computeBuckets(candidates: Candidate[]) {
  const buckets = [
    { label: "90–100", min: 90, max: 101 },
    { label: "80–89", min: 80, max: 90 },
    { label: "70–79", min: 70, max: 80 },
    { label: "60–69", min: 60, max: 70 },
    { label: "50–59", min: 50, max: 60 },
    { label: "<50", min: -1, max: 50 },
  ];
  return buckets.map((b) => {
    const list = candidates.filter((c) => {
      const s = Number(c.confidence_score) || 0;
      return s >= b.min && s < b.max;
    });
    const reviewed = list.filter((c) => c.reviewed_at);
    const approved = list.filter((c) => c.status === "approved").length;
    return {
      label: b.label,
      n: list.length,
      reviewed: reviewed.length,
      approved,
      approvalRate: pct(approved, Math.max(list.length, 1)),
      reviewedApprovalRate: pct(approved, Math.max(reviewed.length, 1)),
    };
  });
}

// ---------- Reviewer analytics ----------
function computeReviewers(candidates: Candidate[], events: Event[]) {
  // first event per candidate determines time-to-review
  const firstByCand = new Map<string, Event>();
  for (const e of events) {
    if (!firstByCand.has(e.candidate_id)) firstByCand.set(e.candidate_id, e);
  }
  const candById = new Map(candidates.map((c) => [c.id, c]));
  const byUser = new Map<string, { user: string; events: Event[]; times: number[] }>();
  for (const e of events) {
    if (!e.user_id) continue;
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, { user: e.user_id, events: [], times: [] });
    byUser.get(e.user_id)!.events.push(e);
    const c = candById.get(e.candidate_id);
    if (c && firstByCand.get(e.candidate_id)?.user_id === e.user_id) {
      const dt = new Date(e.created_at).getTime() - new Date(c.created_at).getTime();
      if (dt > 0) byUser.get(e.user_id)!.times.push(dt);
    }
  }
  return [...byUser.values()]
    .map((u) => {
      const total = u.events.length;
      const approve = u.events.filter((e) => e.action === "approve").length;
      const reject = u.events.filter(
        (e) => e.action === "reject" || e.action === "dismiss",
      ).length;
      const manual = u.events.filter((e) => e.action === "mark_manual_required").length;
      const avgMs = u.times.length
        ? u.times.reduce((a, b) => a + b, 0) / u.times.length
        : 0;
      return {
        user: u.user.slice(0, 8),
        total,
        approveRate: pct(approve, total),
        rejectRate: pct(reject, total),
        manualRate: pct(manual, total),
        avgReviewMin: avgMs / 60000,
      };
    })
    .sort((a, b) => b.total - a.total);
}

// ---------- Recommendations ----------
function computeRecommendations(brandRows: BrandRow[], domainRowsByBrand: Map<string, DomainRow[]>) {
  const recs: { brand: string; text: string; tone: "good" | "warn" | "bad" }[] = [];
  for (const b of brandRows.slice(0, 20)) {
    if (b.total < 20) continue;
    if (b.approvalRate >= 80 && b.avgConfidence >= 75) {
      recs.push({
        brand: b.brand_name,
        text: `${fmtPct(b.approvalRate)} approval rate with avg confidence ${fmtNum(b.avgConfidence, 1)}. Consider auto-shortlisting candidates above 90.`,
        tone: "good",
      });
    }
    if (b.processingFailRate >= 30) {
      recs.push({
        brand: b.brand_name,
        text: `Processing failure rate ${fmtPct(b.processingFailRate)} — investigate provider settings or source quality.`,
        tone: "bad",
      });
    }
    if (b.noCandidateRate >= 40) {
      recs.push({
        brand: b.brand_name,
        text: `${fmtPct(b.noCandidateRate)} of SKUs end with no usable candidate. Profile likely needs additional preferred domains or templates.`,
        tone: "warn",
      });
    }
    const dom = domainRowsByBrand.get(b.brand_id || "__unknown__") || [];
    const worst = dom.find(
      (d) => d.total >= 10 && (d.packagingRate >= 25 || d.diagramRate >= 25 || d.rejectRate >= 70),
    );
    if (worst) {
      const reason =
        worst.packagingRate >= 25
          ? `packaging-image rate ${fmtPct(worst.packagingRate)}`
          : worst.diagramRate >= 25
            ? `diagram rate ${fmtPct(worst.diagramRate)}`
            : `reject rate ${fmtPct(worst.rejectRate)}`;
      recs.push({
        brand: b.brand_name,
        text: `Source ${worst.domain} shows ${reason}. Consider blocking or down-weighting in profile.`,
        tone: "warn",
      });
    }
  }
  return recs;
}

export default function ImageScoutCalibration() {
  const navigate = useNavigate();
  const { data, isLoading, refetch, isRefetching } = useCalibrationData();
  const [selectedBrand, setSelectedBrand] = useState<string>("__all__");
  const [runA, setRunA] = useState<string>("");
  const [runB, setRunB] = useState<string>("");

  const brandRows = useMemo(
    () => (data ? computeBrandRows(data.candidates, data.approved, data.brands) : []),
    [data],
  );
  const domainRows = useMemo(
    () =>
      data
        ? computeDomainRows(
            data.candidates,
            data.approved,
            data.profiles,
            selectedBrand === "__all__" ? null : selectedBrand,
          )
        : [],
    [data, selectedBrand],
  );
  const buckets = useMemo(() => (data ? computeBuckets(data.candidates) : []), [data]);
  const reviewers = useMemo(
    () => (data ? computeReviewers(data.candidates, data.events) : []),
    [data],
  );
  const recommendations = useMemo(() => {
    if (!data) return [];
    const byBrand = new Map<string, DomainRow[]>();
    for (const b of brandRows) {
      const k = b.brand_id || "__unknown__";
      byBrand.set(
        k,
        computeDomainRows(data.candidates, data.approved, data.profiles, b.brand_id),
      );
    }
    return computeRecommendations(brandRows, byBrand);
  }, [brandRows, data]);

  const runMap = useMemo(() => new Map((data?.runs || []).map((r) => [r.id, r])), [data]);
  const runA_ = runMap.get(runA);
  const runB_ = runMap.get(runB);

  const updateProfileDomain = async (
    domain: string,
    op: "preferred" | "blocked" | "remove",
  ) => {
    if (selectedBrand === "__all__") {
      toast.error("Select a single brand first");
      return;
    }
    const profile = data?.profiles.find((p) => p.brand_id === selectedBrand);
    const preferred = new Set(profile?.preferred_domains || []);
    const blocked = new Set(profile?.blocked_domains || []);
    if (op === "preferred") {
      preferred.add(domain);
      blocked.delete(domain);
    } else if (op === "blocked") {
      blocked.add(domain);
      preferred.delete(domain);
    } else {
      preferred.delete(domain);
      blocked.delete(domain);
    }
    const payload = {
      brand_id: selectedBrand,
      preferred_domains: [...preferred],
      blocked_domains: [...blocked],
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("brand_image_profiles")
      .upsert(payload, { onConflict: "brand_id" });
    if (error) toast.error(error.message);
    else {
      toast.success(`Updated profile for ${domain}`);
      refetch();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="text-pd-accent mb-2"
            onClick={() => navigate("/discovery/image-scout")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Image Scout
          </Button>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-pd-accent" />
            Calibration & Operational Intelligence
          </h1>
          <p className="text-muted-foreground mt-1">
            Brand and domain trust signals, score calibration, reviewer behaviour and tuning
            recommendations across the last {WINDOW_DAYS} days.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading calibration data…</p>}

      {data && (
        <Tabs defaultValue="brands">
          <TabsList>
            <TabsTrigger value="brands">Brand performance</TabsTrigger>
            <TabsTrigger value="domains">Domain analytics</TabsTrigger>
            <TabsTrigger value="calibration">Confidence calibration</TabsTrigger>
            <TabsTrigger value="reviewers">Reviewers</TabsTrigger>
            <TabsTrigger value="runs">QA run comparison</TabsTrigger>
            <TabsTrigger value="recs">Recommendations</TabsTrigger>
          </TabsList>

          {/* BRANDS */}
          <TabsContent value="brands" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Brand performance</CardTitle>
                <CardDescription>
                  Aggregated across {data.candidates.length} candidates from {brandRows.length}{" "}
                  brand groups.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Brand</TableHead>
                      <TableHead numeric>SKUs</TableHead>
                      <TableHead numeric>Avg cand/SKU</TableHead>
                      <TableHead numeric>Avg confidence</TableHead>
                      <TableHead numeric>Approval</TableHead>
                      <TableHead numeric>Manual</TableHead>
                      <TableHead numeric>No candidate</TableHead>
                      <TableHead numeric>Process success</TableHead>
                      <TableHead numeric>Process fail</TableHead>
                      <TableHead>Signal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {brandRows.map((r) => {
                      const strong = r.approvalRate >= 70 && r.processingFailRate < 15;
                      const weak =
                        r.approvalRate < 35 || r.processingFailRate >= 30 || r.noCandidateRate >= 40;
                      return (
                        <TableRow key={r.brand_id ?? "unknown"}>
                          <TableCell className="font-medium">{r.brand_name}</TableCell>
                          <TableCell numeric>{r.skus}</TableCell>
                          <TableCell numeric>{fmtNum(r.avgCandidatesPerSku, 1)}</TableCell>
                          <TableCell numeric>{fmtNum(r.avgConfidence, 1)}</TableCell>
                          <TableCell numeric>{fmtPct(r.approvalRate)}</TableCell>
                          <TableCell numeric>{fmtPct(r.manualRate)}</TableCell>
                          <TableCell numeric>{fmtPct(r.noCandidateRate)}</TableCell>
                          <TableCell numeric>{fmtPct(r.successRate)}</TableCell>
                          <TableCell numeric>{fmtPct(r.processingFailRate)}</TableCell>
                          <TableCell>
                            {strong && <Badge className="bg-pd-accent">Strong</Badge>}
                            {weak && <Badge variant="destructive">Needs tuning</Badge>}
                            {!strong && !weak && <Badge variant="outline">Neutral</Badge>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* DOMAINS */}
          <TabsContent value="domains" className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Domain analytics</CardTitle>
                  <CardDescription>
                    Per-source performance. Promote winners, block offenders.
                  </CardDescription>
                </div>
                <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                  <SelectTrigger className="w-[260px]">
                    <SelectValue placeholder="All brands" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All brands</SelectItem>
                    {data.brands
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead numeric>N</TableHead>
                      <TableHead numeric>Avg conf</TableHead>
                      <TableHead numeric>Approval</TableHead>
                      <TableHead numeric>Reject</TableHead>
                      <TableHead numeric>Duplicate</TableHead>
                      <TableHead numeric>Packaging</TableHead>
                      <TableHead numeric>Diagram</TableHead>
                      <TableHead numeric>Process OK</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {domainRows.map((r) => (
                      <TableRow key={r.domain}>
                        <TableCell className="font-medium">{r.domain}</TableCell>
                        <TableCell numeric>{r.total}</TableCell>
                        <TableCell numeric>{fmtNum(r.avgConfidence, 1)}</TableCell>
                        <TableCell numeric>{fmtPct(r.approvalRate)}</TableCell>
                        <TableCell numeric>{fmtPct(r.rejectRate)}</TableCell>
                        <TableCell numeric>{fmtPct(r.duplicateRate)}</TableCell>
                        <TableCell numeric>{fmtPct(r.packagingRate)}</TableCell>
                        <TableCell numeric>{fmtPct(r.diagramRate)}</TableCell>
                        <TableCell numeric>{fmtPct(r.processingSuccessRate)}</TableCell>
                        <TableCell>
                          {r.status === "preferred" && (
                            <Badge className="bg-pd-accent">Preferred</Badge>
                          )}
                          {r.status === "blocked" && <Badge variant="destructive">Blocked</Badge>}
                          {r.status === "neutral" && <Badge variant="outline">—</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateProfileDomain(r.domain, "preferred")}
                              title="Mark preferred"
                            >
                              <ShieldCheck className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateProfileDomain(r.domain, "blocked")}
                              title="Mark blocked"
                            >
                              <ShieldX className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* CALIBRATION */}
          <TabsContent value="calibration" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Confidence calibration</CardTitle>
                <CardDescription>
                  Compare predicted confidence buckets against actual approval outcomes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bucket</TableHead>
                      <TableHead numeric>Candidates</TableHead>
                      <TableHead numeric>Reviewed</TableHead>
                      <TableHead numeric>Approved</TableHead>
                      <TableHead numeric>Approval (all)</TableHead>
                      <TableHead numeric>Approval (reviewed)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {buckets.map((b) => (
                      <TableRow key={b.label}>
                        <TableCell className="font-medium">{b.label}</TableCell>
                        <TableCell numeric>{b.n}</TableCell>
                        <TableCell numeric>{b.reviewed}</TableCell>
                        <TableCell numeric>{b.approved}</TableCell>
                        <TableCell numeric>{fmtPct(b.approvalRate)}</TableCell>
                        <TableCell numeric>{fmtPct(b.reviewedApprovalRate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* REVIEWERS */}
          <TabsContent value="reviewers" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Reviewer analytics</CardTitle>
                <CardDescription>
                  Action mix and time-to-first-decision per reviewer.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reviewer</TableHead>
                      <TableHead numeric>Actions</TableHead>
                      <TableHead numeric>Approve %</TableHead>
                      <TableHead numeric>Reject %</TableHead>
                      <TableHead numeric>Manual %</TableHead>
                      <TableHead numeric>Avg review (min)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reviewers.map((r) => (
                      <TableRow key={r.user}>
                        <TableCell className="font-mono text-xs">{r.user}…</TableCell>
                        <TableCell numeric>{r.total}</TableCell>
                        <TableCell numeric>{fmtPct(r.approveRate)}</TableCell>
                        <TableCell numeric>{fmtPct(r.rejectRate)}</TableCell>
                        <TableCell numeric>{fmtPct(r.manualRate)}</TableCell>
                        <TableCell numeric>{fmtNum(r.avgReviewMin, 1)}</TableCell>
                      </TableRow>
                    ))}
                    {reviewers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-muted-foreground">
                          No review events yet in this window.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* RUNS */}
          <TabsContent value="runs" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>QA run comparison</CardTitle>
                <CardDescription>
                  Pick two QA runs to see deltas in confidence, approval and failures.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Run A", value: runA, set: setRunA },
                    { label: "Run B", value: runB, set: setRunB },
                  ].map((sel) => (
                    <div key={sel.label}>
                      <p className="text-sm text-muted-foreground mb-1">{sel.label}</p>
                      <Select value={sel.value} onValueChange={sel.set}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a QA run" />
                        </SelectTrigger>
                        <SelectContent>
                          {data.runs.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.label} — {new Date(r.created_at).toLocaleDateString()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                {runA_ && runB_ && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metric</TableHead>
                        <TableHead numeric>{runA_.label}</TableHead>
                        <TableHead numeric>{runB_.label}</TableHead>
                        <TableHead numeric>Δ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        { k: "total", label: "SKUs processed" },
                        { k: "candidatesFound", label: "Candidates found" },
                        { k: "avgConf", label: "Avg confidence" },
                        { k: "approved", label: "Approved" },
                        { k: "processed", label: "Processed" },
                        { k: "failed", label: "Failed" },
                        { k: "manual", label: "Manual required" },
                      ].map((row) => {
                        const a = Number(runA_.summary?.[row.k] ?? 0);
                        const b = Number(runB_.summary?.[row.k] ?? 0);
                        const d = b - a;
                        return (
                          <TableRow key={row.k}>
                            <TableCell>{row.label}</TableCell>
                            <TableCell numeric>{fmtNum(a, 2)}</TableCell>
                            <TableCell numeric>{fmtNum(b, 2)}</TableCell>
                            <TableCell
                              numeric
                              className={
                                d > 0 ? "text-pd-accent" : d < 0 ? "text-destructive" : ""
                              }
                            >
                              {d > 0 ? "+" : ""}
                              {fmtNum(d, 2)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* RECS */}
          <TabsContent value="recs" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-pd-accent" />
                  Suggested automation thresholds
                </CardTitle>
                <CardDescription>
                  Heuristic guidance derived from the metrics above. Review before acting — no
                  automation is enabled.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {recommendations.length === 0 && (
                  <p className="text-muted-foreground">
                    Not enough data yet to generate trustworthy recommendations.
                  </p>
                )}
                {recommendations.map((r, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border/60 bg-card p-3 flex items-start gap-3"
                  >
                    <Badge
                      variant={
                        r.tone === "good" ? "default" : r.tone === "bad" ? "destructive" : "outline"
                      }
                    >
                      {r.brand}
                    </Badge>
                    <p className="text-sm text-foreground">{r.text}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
