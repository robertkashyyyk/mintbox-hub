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
import { toast } from "sonner";
import { FileText, Upload, RefreshCw, Loader2, FileWarning } from "lucide-react";

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
  created_at: string;
  carriers?: { name: string } | null;
  penalty_count?: number;
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

const CarrierDocuments = () => {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [carrierId, setCarrierId] = useState<string>("");
  const [docType, setDocType] = useState<string>("penalty_notice");
  const [docDate, setDocDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: c }, { data: d }] = await Promise.all([
      supabase.from("carriers").select("id, name, slug").eq("active", true).order("name"),
      supabase
        .from("carrier_documents")
        .select("id, carrier_id, doc_type, document_date, total_amount, parse_status, parse_error, file_path, created_at, carriers(name)")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setCarriers((c as Carrier[]) ?? []);
    if (!carrierId && c && c.length) setCarrierId(c[0].id);

    // Penalty counts per document
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
          parse_status: "pending",
        })
        .select("id")
        .single();
      if (insErr) throw insErr;

      toast.success("Uploaded — AI extraction starting");
      if (fileRef.current) fileRef.current.value = "";
      await load();

      // Trigger parser (don't await UI on it)
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
        <h1 className="text-3xl font-bold tracking-tight text-white">Carrier Documents</h1>
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
            PDF only. After upload the document is parsed by AI in the background.
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
            <CardDescription>Most recent uploads first.</CardDescription>
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
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Penalties</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No documents yet. Upload your first PDF above.
                    </TableCell>
                  </TableRow>
                )}
                {docs.map((d) => {
                  const status = STATUS_VARIANTS[d.parse_status] ?? STATUS_VARIANTS.pending;
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs">{d.document_date}</TableCell>
                      <TableCell>{d.carriers?.name ?? "—"}</TableCell>
                      <TableCell className="capitalize">{d.doc_type.replace("_", " ")}</TableCell>
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
                      <TableCell className="text-right">{d.penalty_count ?? 0}</TableCell>
                      <TableCell className="text-right font-mono">
                        {d.total_amount != null ? `£${Number(d.total_amount).toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
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
