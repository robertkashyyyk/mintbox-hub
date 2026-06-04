import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  FileText,
  Upload,
  RefreshCw,
  Loader2,
  FileWarning,
  Eye,
  ExternalLink,
} from "lucide-react";

type Carrier = { id: string; name: string; slug: string };
type DocRow = {
  id: string;
  carrier_id: string;
  doc_type: string;
  document_date: string;
  total_amount: number | null;
  parse_status: string;
  parse_error: string | null;
  file_path: string;
  original_filename: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  created_at: string;
  carriers?: { name: string } | null;
  penalty_count?: number;
};
type PenaltyRow = {
  id: string;
  penalty_date: string | null;
  tracking_number: string | null;
  sku: string | null;
  reason_code: string | null;
  reason_text: string | null;
  declared_format: string | null;
  actual_format: string | null;
  penalty_amount: number;
  resolution_status: string;
};

const DOC_TYPES = [
  { value: "invoice", label: "Invoice" },
  { value: "penalty_notice", label: "Penalty Notice" },
  { value: "claim", label: "Claim" },
  { value: "other", label: "Other" },
];

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  parsing: { label: "Parsing…", className: "bg-blue-500/15 text-blue-300 border border-blue-500/30" },
  parsed: { label: "Parsed", className: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive border border-destructive/30" },
  manual: { label: "Manual", className: "bg-amber-500/15 text-amber-300 border border-amber-500/30" },
};

function formatBytes(n: number | null | undefined) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const CarrierDocuments = () => {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [carrierId, setCarrierId] = useState<string>("");
  const [docType, setDocType] = useState<string>("penalty_notice");
  const [docDate, setDocDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const fileRef = useRef<HTMLInputElement>(null);

  // Preview drawer state
  const [previewDoc, setPreviewDoc] = useState<DocRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [penalties, setPenalties] = useState<PenaltyRow[]>([]);
  const [penaltiesLoading, setPenaltiesLoading] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: c }, { data: d }] = await Promise.all([
      supabase.from("carriers").select("id, name, slug").eq("active", true).order("name"),
      supabase
        .from("carrier_documents")
        .select(
          "id, carrier_id, doc_type, document_date, total_amount, parse_status, parse_error, file_path, original_filename, file_size_bytes, mime_type, created_at, carriers(name)"
        )
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setCarriers((c as Carrier[]) ?? []);
    if (!carrierId && c && c.length) setCarrierId(c[0].id);

    const docList = (d as DocRow[]) ?? [];
    if (docList.length) {
      const ids = docList.map((x) => x.id);
      const { data: counts } = await supabase
        .from("carrier_penalties")
        .select("document_id")
        .in("document_id", ids);
      const map = new Map<string, number>();
      (counts ?? []).forEach((r: any) => {
        map.set(r.document_id, (map.get(r.document_id) ?? 0) + 1);
      });
      docList.forEach((x) => (x.penalty_count = map.get(x.id) ?? 0));
    }
    setDocs(docList);
    setLoading(false);
  }

  // Poll while any docs are parsing
  useEffect(() => {
    const hasParsing = docs.some((d) => d.parse_status === "parsing");
    if (!hasParsing) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a PDF first");
      return;
    }
    if (!carrierId) {
      toast.error("Pick a carrier");
      return;
    }
    if (file.type !== "application/pdf") {
      toast.error("Only PDF files are supported");
      return;
    }

    // Hard duplicate check: SHA-256 hash of file contents (rename-proof)
    const hashBuffer = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const fileHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

    const { data: hashDupes } = await supabase
      .from("carrier_documents")
      .select("id, document_date, doc_type, original_filename")
      .eq("file_hash", fileHash)
      .limit(1);

    if (hashDupes && hashDupes.length > 0) {
      const d = hashDupes[0] as any;
      toast.error(`This file has already been uploaded (${d.original_filename ?? "unknown"} · ${d.document_date}). Identical content detected.`);
      return;
    }

    // Soft fallback: same filename for the same carrier (different file, same name)
    const { data: nameDupes } = await supabase
      .from("carrier_documents")
      .select("id, document_date, doc_type")
      .eq("carrier_id", carrierId)
      .eq("original_filename", file.name)
      .limit(3);

    if (nameDupes && nameDupes.length > 0) {
      const carrierName = carriers.find((c) => c.id === carrierId)?.name ?? "this carrier";
      const lines = nameDupes
        .map((x: any) => `• ${x.document_date} — ${String(x.doc_type).replace("_", " ")}`)
        .join("\n");
      const proceed = window.confirm(
        `A file named "${file.name}" was already uploaded for ${carrierName}:\n\n${lines}\n\nUpload again anyway?`
      );
      if (!proceed) return;
    }

    setUploading(true);
    try {
      const ts = Date.now();
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${carrierId}/${ts}_${safeName}`;

      const { error: upErr } = await supabase.storage
        .from("carrier-documents")
        .upload(path, file, { contentType: "application/pdf", upsert: false });
      if (upErr) throw upErr;

      const { data: inserted, error: insErr } = await supabase
        .from("carrier_documents")
        .insert({
          carrier_id: carrierId,
          doc_type: docType,
          document_date: docDate,
          file_path: path,
          original_filename: file.name,
          file_size_bytes: file.size,
          mime_type: file.type || "application/pdf",
          parse_status: "pending",
          file_hash: fileHash,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      toast.success("Uploaded — AI extraction starting");
      if (fileRef.current) fileRef.current.value = "";
      await load();

      void triggerParse(inserted!.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function triggerParse(documentId: string) {
    const { error } = await supabase.functions.invoke("parse-carrier-document", {
      body: { document_id: documentId },
    });
    if (error) toast.error(`Parse failed: ${error.message}`);
    void load();
  }

  async function openPreview(doc: DocRow) {
    setPreviewDoc(doc);
    setPreviewUrl(null);
    setPenalties([]);
    setPenaltiesLoading(true);

    const [{ data: signed }, { data: pens }] = await Promise.all([
      supabase.storage
        .from("carrier-documents")
        .createSignedUrl(doc.file_path, 60 * 60), // 1 hour
      supabase
        .from("carrier_penalties")
        .select(
          "id, penalty_date, tracking_number, sku, reason_code, reason_text, declared_format, actual_format, penalty_amount, resolution_status"
        )
        .eq("document_id", doc.id)
        .order("penalty_date", { ascending: false }),
    ]);

    setPreviewUrl(signed?.signedUrl ?? null);
    setPenalties((pens as PenaltyRow[]) ?? []);
    setPenaltiesLoading(false);
  }

  const stats = useMemo(() => {
    const total = docs.length;
    const parsed = docs.filter((d) => d.parse_status === "parsed").length;
    const failed = docs.filter((d) => d.parse_status === "failed").length;
    const sum = docs.reduce((acc, d) => acc + (Number(d.total_amount) || 0), 0);
    return { total, parsed, failed, sum };
  }, [docs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Carrier Documents</h1>
        <p className="text-muted-foreground mt-1">
          Upload courier invoices and penalty notices. AI extracts every penalty line automatically.
        </p>
      </div>

      {/* Upload card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            <CardTitle>Upload document</CardTitle>
          </div>
          <CardDescription>
            PDF only. After upload the document is parsed by AI in the background. If a file with
            the same name was already uploaded for this carrier, you'll be warned before continuing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1.5">
              <Label>Carrier</Label>
              <Select value={carrierId} onValueChange={setCarrierId}>
                <SelectTrigger><SelectValue placeholder="Select carrier" /></SelectTrigger>
                <SelectContent>
                  {carriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Document type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Document date</Label>
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>PDF file</Label>
              <Input ref={fileRef} type="file" accept="application/pdf" />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              Upload &amp; Parse
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Documents" value={stats.total} />
        <StatCard label="Parsed" value={stats.parsed} />
        <StatCard label="Failed" value={stats.failed} />
        <StatCard label="Total invoiced" value={`£${stats.sum.toFixed(2)}`} />
      </div>

      {/* Library */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <CardTitle>Document library</CardTitle>
            </div>
            <CardDescription>Click any row to view the original PDF and the extracted lines.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead numeric>Penalties</TableHead>
                  <TableHead numeric>Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No documents yet. Upload your first PDF above.
                    </TableCell>
                  </TableRow>
                )}
                {docs.map((d) => {
                  const status = STATUS_VARIANTS[d.parse_status] ?? STATUS_VARIANTS.pending;
                  const fname = d.original_filename ?? d.file_path.split("/").pop() ?? "—";
                  return (
                    <TableRow
                      key={d.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => void openPreview(d)}
                    >
                      <TableCell className="font-mono text-xs">{d.document_date}</TableCell>
                      <TableCell>{d.carriers?.name ?? "—"}</TableCell>
                      <TableCell className="capitalize">{d.doc_type.replace("_", " ")}</TableCell>
                      <TableCell className="max-w-[280px]">
                        <div className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate text-sm" title={fname}>{fname}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatBytes(d.file_size_bytes)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge className={status.className} variant="outline">{status.label}</Badge>
                          {d.parse_error && (
                            <span title={d.parse_error}>
                              <FileWarning className="h-4 w-4 text-destructive" />
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell numeric>{d.penalty_count ?? 0}</TableCell>
                      <TableCell numeric>
                        {d.total_amount != null ? `£${Number(d.total_amount).toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void openPreview(d)}
                          className="mr-1"
                        >
                          <Eye className="h-4 w-4 mr-1" /> View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void triggerParse(d.id)}
                          disabled={d.parse_status === "parsing"}
                        >
                          {d.parse_status === "failed" ? "Retry" : "Re-parse"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Preview drawer */}
      <Sheet open={!!previewDoc} onOpenChange={(o) => !o && setPreviewDoc(null)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[95vw] p-0 flex flex-col"
        >
          <SheetHeader className="px-6 py-4 border-b border-border/80">
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <span className="truncate">{previewDoc?.original_filename ?? previewDoc?.file_path?.split("/").pop()}</span>
            </SheetTitle>
            <SheetDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>{previewDoc?.carriers?.name}</span>
              <span className="capitalize">{previewDoc?.doc_type?.replace("_", " ")}</span>
              <span>{previewDoc?.document_date}</span>
              <span>{formatBytes(previewDoc?.file_size_bytes)}</span>
              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  Open in new tab <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="grid grid-cols-1 lg:grid-cols-2 flex-1 min-h-0">
            {/* Original PDF */}
            <div className="border-r border-border/80 bg-muted/20 min-h-[60vh] lg:min-h-0">
              {previewUrl ? (
                <iframe
                  src={previewUrl}
                  className="w-full h-full min-h-[60vh]"
                  title="Original document"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading preview…
                </div>
              )}
            </div>

            {/* Parsed lines */}
            <div className="overflow-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Extracted lines ({penalties.length})
                </h3>
                {previewDoc?.total_amount != null && (
                  <div className="text-sm">
                    Total:{" "}
                    <span className="font-mono font-semibold">
                      £{Number(previewDoc.total_amount).toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {penaltiesLoading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
                </div>
              ) : penalties.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  No extracted lines yet.
                  {previewDoc?.parse_status !== "parsed" && " Document hasn't finished parsing."}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Tracking</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Declared → Actual</TableHead>
                      <TableHead numeric>Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {penalties.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">
                          {p.penalty_date ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {p.tracking_number ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{p.sku ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {p.reason_code ? (
                            <span className="font-mono mr-1">{p.reason_code}</span>
                          ) : null}
                          <span className="text-muted-foreground">{p.reason_text ?? ""}</span>
                        </TableCell>
                        <TableCell className="text-xs">
                          {p.declared_format || p.actual_format
                            ? `${p.declared_format ?? "?"} → ${p.actual_format ?? "?"}`
                            : "—"}
                        </TableCell>
                        <TableCell numeric>
                          £{Number(p.penalty_amount).toFixed(2)}
                        </TableCell>
                        <TableCell className="capitalize text-xs">
                          {p.resolution_status.replace("_", " ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

const StatCard = ({ label, value }: { label: string; value: string | number }) => (
  <Card>
    <CardContent className="pt-6">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </CardContent>
  </Card>
);

export default CarrierDocuments;
