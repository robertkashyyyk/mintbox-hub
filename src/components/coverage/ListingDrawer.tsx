/**
 * ListingDrawer — per-SKU listing editor for Opportunities. Opens from a SKU
 * click. Edit everything the GTC template needs (title, description, category,
 * MPN, size, condition, price), upload a missing image, then Save (→ draft the
 * generator reads) or Push to list (→ listing_queue, which O3b drains to SFTP).
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Upload, Loader2, Save, Send, ImageOff } from "lucide-react";
import { bandRecoveryTarget } from "@/lib/reprice";

interface Detail {
  sku: string; product_id: string; title: string; description: string | null; brand_name: string | null;
  barcode: string | null; cost_price: number; stock: number; ebay_category_id: string | null;
  ebay_category_name: string | null; mpn: string | null; size: string | null; condition: string | null; price: number | null;
  weight: number | null; height: number | null; length: number | null; depth: number | null; image_url: string | null;
  has_category: boolean; has_image: boolean; has_dims: boolean; has_barcode: boolean; has_brand: boolean;
  queued_pending: number;
}

const CONDITIONS = [["1000", "New"], ["1500", "New other"], ["3000", "Used"], ["7000", "For parts / not working"]];

function Check({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`inline-flex items-center gap-1 text-xs ${ok ? "text-emerald-400" : "text-destructive"}`}>{ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{label}</span>;
}

export default function ListingDrawer({ sku, onClose, onChanged }: { sku: string | null; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ title: "", description: "", ebay_category_id: "", ebay_category_name: "", mpn: "", size: "", condition: "1000", price: "" });
  const [pushStores, setPushStores] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ["listing-detail", sku],
    enabled: !!sku,
    queryFn: async (): Promise<Detail | null> => {
      const { data, error } = await (supabase as any).rpc("get_listing_detail", { p_sku: sku });
      if (error) throw error;
      return (data?.[0] ?? null) as Detail | null;
    },
  });

  const { data: stores = [] } = useQuery({
    queryKey: ["threeds-stores-list"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("threeds_stores").select("id, store_name").eq("enabled", true).order("store_name");
      return (data ?? []) as { id: string; store_name: string }[];
    },
  });

  const { data: cats = [] } = useQuery({
    queryKey: ["ebay-cat-options"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("ebay_category_map").select("ebay_category_id, ebay_category_name").order("ebay_category_name");
      const seen = new Set<string>(); const out: { ebay_category_id: string; ebay_category_name: string | null }[] = [];
      for (const c of (data ?? [])) { if (!seen.has(c.ebay_category_id)) { seen.add(c.ebay_category_id); out.push(c); } }
      return out;
    },
  });

  useEffect(() => {
    if (detail) setF({
      title: detail.title ?? "", description: detail.description ?? "",
      ebay_category_id: detail.ebay_category_id ?? "", ebay_category_name: detail.ebay_category_name ?? "",
      mpn: detail.mpn ?? "", size: detail.size ?? "", condition: detail.condition ?? "1000",
      price: detail.price != null ? String(detail.price) : "",
    });
  }, [detail]);

  const goodPrice = detail ? bandRecoveryTarget({ costUnit: Number(detail.cost_price || 0), tier: "good" }) : null;

  const save = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("listing_drafts").upsert({
        sku, title: f.title.trim() || null, description: f.description.trim() || null,
        ebay_category_id: f.ebay_category_id.trim() || null, ebay_category_name: f.ebay_category_name.trim() || null,
        mpn: f.mpn.trim() || null, size: f.size.trim() || null, condition: f.condition || null,
        price: f.price.trim() ? Number(f.price) : null, updated_by: user?.id ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: "sku" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Draft saved"); refetch(); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });

  async function uploadImage(file: File) {
    if (!detail) return;
    setUploading(true);
    try {
      // Flat, sanitised key (SKUs can contain "/" etc.) — matches the proven uploaders.
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${(sku ?? "").replace(/[^a-zA-Z0-9._-]/g, "_")}.${ext}`;
      const { error: upErr } = await supabase.storage.from("product-images").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
      const { error: dbErr } = await (supabase as any).from("product_images").insert({
        product_id: detail.product_id, file_path: path, public_url: urlData.publicUrl, display_order: 0, is_primary: true,
      });
      if (dbErr) throw dbErr;
      toast.success("Image uploaded");
      refetch(); onChanged();
    } catch (e: any) { toast.error(e.message); } finally { setUploading(false); }
  }

  const pushToList = useMutation({
    mutationFn: async () => {
      if (pushStores.size === 0) throw new Error("Pick at least one store");
      await save.mutateAsync(); // persist edits first
      const { data: { user } } = await supabase.auth.getUser();
      let queued = 0, already = 0;
      for (const store_id of pushStores) {
        const { error } = await (supabase as any).from("listing_queue").insert({ sku, store_id, queued_by: user?.id ?? null });
        if (error) { if (error.code === "23505") already++; else throw error; } else queued++;
      }
      return { queued, already };
    },
    onSuccess: (r) => { toast.success(`Pushed to list — ${r.queued} queued${r.already ? `, ${r.already} already queued` : ""}`); setPushStores(new Set()); refetch(); onChanged(); },
    onError: (e: any) => toast.error(e.message),
  });

  const readyCount = detail ? [detail.has_category, detail.has_image, detail.has_dims, detail.has_barcode, detail.has_brand].filter(Boolean).length : 0;
  const isReady = readyCount === 5;

  return (
    <Sheet open={!!sku} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono flex items-center gap-2">{sku}
            {detail && (isReady ? <Badge variant="outline" className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Ready</Badge> : <Badge variant="outline" className="text-xs">{readyCount}/5</Badge>)}
          </SheetTitle>
          <SheetDescription>Edit the listing details, then save the draft or push it to the listing queue.</SheetDescription>
        </SheetHeader>

        {isLoading || !detail ? <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
          <div className="space-y-4 py-4">
            {/* Readiness */}
            <div className="flex flex-wrap gap-3 rounded-lg border border-border/60 p-3">
              <Check ok={detail.has_category} label="Category" /><Check ok={detail.has_image} label="Image" />
              <Check ok={detail.has_dims} label="Dims" /><Check ok={detail.has_barcode} label="EAN" /><Check ok={detail.has_brand} label="Brand" />
            </div>

            {/* Image */}
            <div className="space-y-2">
              <Label className="text-xs">Image</Label>
              <div className="flex items-center gap-3">
                {detail.image_url
                  ? <img src={detail.image_url} alt={sku ?? ""} className="h-24 w-24 object-contain rounded border border-border bg-muted/30" />
                  : <div className="h-24 w-24 rounded border border-dashed border-border flex items-center justify-center text-muted-foreground"><ImageOff className="h-6 w-6" /></div>}
                <div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && uploadImage(e.target.files[0])} />
                  <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}{detail.image_url ? "Replace image" : "Upload image"}</Button>
                </div>
              </div>
            </div>

            {/* Editable fields */}
            <div className="space-y-1.5"><Label className="text-xs">Title <span className="text-muted-foreground">({f.title.length}/80)</span></Label><Input maxLength={80} value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Description</Label><Textarea rows={4} value={f.description} onChange={e => setF(s => ({ ...s, description: e.target.value }))} placeholder="Listing description (HTML allowed)" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2"><Label className="text-xs">eBay category</Label>
                <Select value={f.ebay_category_id} onValueChange={v => { const m = cats.find(c => c.ebay_category_id === v); setF(s => ({ ...s, ebay_category_id: v, ebay_category_name: m?.ebay_category_name ?? s.ebay_category_name })); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select a category" /></SelectTrigger>
                  <SelectContent>
                    {f.ebay_category_id && !cats.find(c => c.ebay_category_id === f.ebay_category_id) && <SelectItem value={f.ebay_category_id}>{f.ebay_category_name || f.ebay_category_id} (current)</SelectItem>}
                    {cats.map(c => <SelectItem key={c.ebay_category_id} value={c.ebay_category_id}>{c.ebay_category_name ? `${c.ebay_category_name} (${c.ebay_category_id})` : c.ebay_category_id}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">{f.ebay_category_id ? `${f.ebay_category_name || "—"} · ${f.ebay_category_id}` : "Manage the list in Admin → eBay Categories"}</p>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">MPN</Label><Input value={f.mpn} onChange={e => setF(s => ({ ...s, mpn: e.target.value }))} placeholder="Manufacturer part no." /></div>
              <div className="space-y-1.5"><Label className="text-xs">Size</Label><Input value={f.size} onChange={e => setF(s => ({ ...s, size: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Condition</Label>
                <Select value={f.condition} onValueChange={v => setF(s => ({ ...s, condition: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{CONDITIONS.map(([id, lbl]) => <SelectItem key={id} value={id}>{lbl}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Price (£)</Label><Input type="number" step="0.01" value={f.price} onChange={e => setF(s => ({ ...s, price: e.target.value }))} placeholder={goodPrice != null ? `Good band ≈ ${goodPrice.toFixed(2)}` : "auto"} /></div>
            </div>

            {/* Read-only catalogue facts */}
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/30 border border-border/50 p-3 text-xs">
              <div><span className="text-muted-foreground">Brand</span><div>{detail.brand_name ?? "—"}</div></div>
              <div><span className="text-muted-foreground">EAN</span><div>{detail.barcode ?? "—"}</div></div>
              <div><span className="text-muted-foreground">Cost</span><div>£{Number(detail.cost_price).toFixed(2)}</div></div>
              <div><span className="text-muted-foreground">Stock</span><div>{detail.stock}</div></div>
              <div className="col-span-2"><span className="text-muted-foreground">Dims (L·H·D / wt)</span><div>{detail.length ?? "—"}·{detail.height ?? "—"}·{detail.depth ?? "—"} / {detail.weight ?? "—"}</div></div>
            </div>

            {/* Save */}
            <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save draft</Button>

            {/* Push to list */}
            <div className="space-y-2 rounded-lg border border-pd-accent/30 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Push to list</Label>
                {detail.queued_pending > 0 && <Badge variant="outline" className="text-xs text-amber-400">{detail.queued_pending} already queued</Badge>}
              </div>
              {!isReady && <p className="text-xs text-amber-400">Not fully ready ({readyCount}/5) — you can still queue it, but the listing may be rejected until the missing fields are filled.</p>}
              <div className="grid grid-cols-2 gap-2">
                {stores.map(s => (
                  <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer"><Checkbox checked={pushStores.has(s.id)} onCheckedChange={v => setPushStores(prev => { const n = new Set(prev); v ? n.add(s.id) : n.delete(s.id); return n; })} />{s.store_name}</label>
                ))}
              </div>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" disabled={pushToList.isPending || pushStores.size === 0} onClick={() => pushToList.mutate()}>{pushToList.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Push to {pushStores.size || ""} store(s)' queue</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
