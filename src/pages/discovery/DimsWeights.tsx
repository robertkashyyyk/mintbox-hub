import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ModuleHeader from "@/components/ModuleHeader";
import { Ruler, ArrowLeft, Check, X, Pencil, ExternalLink, Info, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// New tables (web_search_*) are not yet in the generated Supabase types — cast.
// Regenerate types after the migration is applied to drop this cast.
const db = supabase as any;

type Proposal = {
  id: string;
  sku: string;
  proposed_length_cm: number | null;
  proposed_depth_cm: number | null;
  proposed_height_cm: number | null;
  proposed_weight_g: number | null;
  is_packaged: boolean | null;
  padded: boolean;
  match_key: "ean" | "brand_partno" | "name" | null;
  confidence: "high" | "medium" | "low" | null;
  source_count: number;
  source_url: string | null;
  status: string;
  created_at: string;
};

type ProductInfo = {
  sku: string;
  name: string | null;
  barcode: string | null;
  height: number | null;
  length: number | null;
  depth: number | null;
  weight: number | null;
};

const fmt = (v: number | null | undefined, suffix = "") =>
  v == null ? "—" : `${v}${suffix}`;

const confidenceBadge = (c: Proposal["confidence"]) => {
  if (c === "high") return <Badge className="bg-emerald-600 hover:bg-emerald-600">High</Badge>;
  if (c === "medium") return <Badge className="bg-amber-500 hover:bg-amber-500">Medium</Badge>;
  if (c === "low") return <Badge variant="secondary">Low</Badge>;
  return <Badge variant="outline">—</Badge>;
};

const matchKeyLabel: Record<string, string> = {
  ean: "Barcode",
  brand_partno: "Brand + part no.",
  name: "Name",
};

const DimsWeights = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>("pending_review");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [editVals, setEditVals] = useState({ length: "", depth: "", height: "", weight: "" });

  // ── Headline stats (live, from current catalogue) ──────────────
  const { data: stats } = useQuery({
    queryKey: ["dims-weights-stats"],
    queryFn: async () => {
      const missingDims = await supabase
        .from("products_cache")
        .select("sku", { count: "exact", head: true })
        .eq("active", true)
        .or("height.is.null,length.is.null,depth.is.null");

      const missingWithBarcode = await supabase
        .from("products_cache")
        .select("sku", { count: "exact", head: true })
        .eq("active", true)
        .not("barcode", "is", null)
        .or("height.is.null,length.is.null,depth.is.null");

      const pending = await db
        .from("web_search_proposals")
        .select("id", { count: "exact", head: true })
        .eq("tool", "dims_weights")
        .eq("status", "pending_review");

      const applied = await db
        .from("web_search_proposals")
        .select("id", { count: "exact", head: true })
        .eq("tool", "dims_weights")
        .in("status", ["approved", "applied"]);

      return {
        missingDims: missingDims.count ?? 0,
        missingWithBarcode: missingWithBarcode.count ?? 0,
        pending: pending.count ?? 0,
        applied: applied.count ?? 0,
      };
    },
  });

  // ── Proposals (+ joined product info) ──────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["dims-weights-proposals", statusFilter, confidenceFilter],
    queryFn: async () => {
      let q = db
        .from("web_search_proposals")
        .select("*")
        .eq("tool", "dims_weights")
        .order("created_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (confidenceFilter !== "all") q = q.eq("confidence", confidenceFilter);

      const { data: proposals, error } = await q;
      if (error) throw error;

      const skus = [...new Set((proposals ?? []).map((p: Proposal) => p.sku))];
      const products: Record<string, ProductInfo> = {};
      if (skus.length) {
        const { data: prods } = await supabase
          .from("products_cache")
          .select("sku,name,barcode,height,length,depth,weight")
          .in("sku", skus);
        (prods ?? []).forEach((p: any) => (products[p.sku] = p));
      }
      return { proposals: (proposals ?? []) as Proposal[], products };
    },
  });

  const proposals = (data?.proposals ?? []).filter((p) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    const name = data?.products[p.sku]?.name ?? "";
    return p.sku.toLowerCase().includes(s) || name.toLowerCase().includes(s);
  });

  // ── Mutations ──────────────────────────────────────────────────
  const approve = useMutation({
    mutationFn: async (p: Proposal) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();

      // Only write fields the proposal actually has — never null out existing data.
      const update: Record<string, any> = {
        dim_search_status: "approved",
        dim_search_checked_at: now,
      };
      if (p.proposed_height_cm != null) update.height = p.proposed_height_cm;
      if (p.proposed_length_cm != null) update.length = p.proposed_length_cm;
      if (p.proposed_depth_cm != null) update.depth = p.proposed_depth_cm;
      if (p.proposed_weight_g != null) update.weight = p.proposed_weight_g;

      const { error: pErr } = await db.from("products_cache").update(update).eq("sku", p.sku);
      if (pErr) throw pErr;

      const { error: prErr } = await db
        .from("web_search_proposals")
        .update({ status: "applied", reviewed_by: user?.id ?? null, reviewed_at: now, applied_at: now })
        .eq("id", p.id);
      if (prErr) throw prErr;
    },
    onSuccess: () => {
      toast.success("Approved — written to catalogue, queued for Mintsoft");
      queryClient.invalidateQueries({ queryKey: ["dims-weights-proposals"] });
      queryClient.invalidateQueries({ queryKey: ["dims-weights-stats"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Approve failed"),
  });

  const reject = useMutation({
    mutationFn: async (p: Proposal) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await db
        .from("web_search_proposals")
        .update({ status: "rejected", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rejected");
      queryClient.invalidateQueries({ queryKey: ["dims-weights-proposals"] });
      queryClient.invalidateQueries({ queryKey: ["dims-weights-stats"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Reject failed"),
  });

  const saveEdit = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const num = (s: string) => (s.trim() === "" ? null : Number(s));
      const { error } = await db
        .from("web_search_proposals")
        .update({
          proposed_length_cm: num(editVals.length),
          proposed_depth_cm: num(editVals.depth),
          proposed_height_cm: num(editVals.height),
          proposed_weight_g: num(editVals.weight),
        })
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Updated");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["dims-weights-proposals"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });

  const openEdit = (p: Proposal) => {
    setEditVals({
      length: p.proposed_length_cm?.toString() ?? "",
      depth: p.proposed_depth_cm?.toString() ?? "",
      height: p.proposed_height_cm?.toString() ?? "",
      weight: p.proposed_weight_g?.toString() ?? "",
    });
    setEditing(p);
  };

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate("/discovery/web-searcher")}
        className="flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Web Searcher
      </button>

      <ModuleHeader
        title="Dims & Weights"
        description="Web-sourced product dimensions & weights, awaiting your review before they are saved and pushed to Mintsoft."
        icon={Ruler}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Missing dimensions" value={stats?.missingDims} hint="active products" />
        <StatCard label="…with a barcode" value={stats?.missingWithBarcode} hint="ready for EAN lookup" />
        <StatCard label="Pending review" value={stats?.pending} />
        <StatCard label="Applied" value={stats?.applied} />
      </div>

      {/* Worker status notice */}
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <Info className="h-4 w-4 mt-0.5 text-amber-500 flex-shrink-0" />
          <div>
            <span className="font-medium">Search worker not yet running.</span> The lookup agent
            starts once the Brave Search and Anthropic API keys are added. Until then this screen
            shows the candidate pool and is ready to review proposals as soon as they arrive.
            <div className="mt-2">
              <Button size="sm" variant="outline" disabled>
                <Search className="h-3.5 w-3.5 mr-1" /> Run search now (awaiting API keys)
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending_review">Pending review</SelectItem>
            <SelectItem value="applied">Applied</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="no_data">No data found</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Confidence" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any confidence</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Search SKU or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-60"
        />
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-foreground/70">
            {isLoading ? "Loading…" : `${proposals.length} proposal${proposals.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU / Product</TableHead>
                <TableHead>Current (L×D×H cm · g)</TableHead>
                <TableHead>Proposed (L×D×H cm · g)</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Matched on</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && proposals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-foreground/50 py-10">
                    No proposals yet. They will appear here once the search worker runs.
                  </TableCell>
                </TableRow>
              )}
              {proposals.map((p) => {
                const prod = data?.products[p.sku];
                return (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-[260px]">
                      <div className="font-medium">{p.sku}</div>
                      <div className="text-xs text-foreground/50 truncate">{prod?.name ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-xs text-foreground/60 whitespace-nowrap">
                      {fmt(prod?.length)}×{fmt(prod?.depth)}×{fmt(prod?.height)} · {fmt(prod?.weight)}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap font-medium">
                      {fmt(p.proposed_length_cm)}×{fmt(p.proposed_depth_cm)}×{fmt(p.proposed_height_cm)} · {fmt(p.proposed_weight_g)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.is_packaged === true ? (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Packaged</Badge>
                      ) : p.is_packaged === false ? (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                          Bare{p.padded ? " +pad" : ""}
                        </Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {confidenceBadge(p.confidence)}
                        {p.source_count > 0 && (
                          <span className="text-[10px] text-foreground/40">×{p.source_count}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-foreground/60">
                      {p.match_key ? matchKeyLabel[p.match_key] : "—"}
                    </TableCell>
                    <TableCell>
                      {p.source_url ? (
                        <a href={p.source_url} target="_blank" rel="noopener noreferrer"
                           className="text-primary hover:underline inline-flex items-center gap-0.5 text-xs">
                          view <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status === "pending_review" ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)} title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600"
                                  onClick={() => approve.mutate(p)} disabled={approve.isPending} title="Approve">
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                                  onClick={() => reject.mutate(p)} disabled={reject.isPending} title="Reject">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-xs capitalize">{p.status.replace("_", " ")}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit proposed values — {editing?.sku}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Length (cm)</Label>
              <Input value={editVals.length} onChange={(e) => setEditVals({ ...editVals, length: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Depth (cm)</Label>
              <Input value={editVals.depth} onChange={(e) => setEditVals({ ...editVals, depth: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Height (cm)</Label>
              <Input value={editVals.height} onChange={(e) => setEditVals({ ...editVals, height: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Weight (g)</Label>
              <Input value={editVals.weight} onChange={(e) => setEditVals({ ...editVals, weight: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const StatCard = ({ label, value, hint }: { label: string; value?: number; hint?: string }) => (
  <Card>
    <CardContent className="py-4">
      <div className="text-2xl font-bold tracking-tight">
        {value == null ? "—" : value.toLocaleString()}
      </div>
      <div className="text-xs text-foreground/60">{label}</div>
      {hint && <div className="text-[10px] text-foreground/40 mt-0.5">{hint}</div>}
    </CardContent>
  </Card>
);

export default DimsWeights;
