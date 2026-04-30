import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Truck, Tag, Users, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Carrier = { id: string; name: string; slug: string; active: boolean };
type ReasonCode = { id: string; carrier_id: string | null; code: string; label: string; description: string | null; active: boolean };
type Packer = { id: string; name: string; email: string | null; active: boolean; notes: string | null };

const CarrierSettings = () => {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [packers, setPackers] = useState<Packer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [c, r, p] = await Promise.all([
      supabase.from("carriers").select("*").order("name"),
      supabase.from("carrier_reason_codes" as any).select("*").order("code"),
      supabase.from("carrier_packers" as any).select("*").order("name"),
    ]);
    if (c.data) setCarriers(c.data as Carrier[]);
    if (r.data) setReasons(r.data as ReasonCode[]);
    if (p.data) setPackers(p.data as Packer[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Carrier Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage carriers, reason code labels, and the packer roster used for remeasure assignments.
        </p>
      </div>

      <Tabs defaultValue="carriers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="carriers"><Truck className="h-4 w-4 mr-2" />Carriers</TabsTrigger>
          <TabsTrigger value="reasons"><Tag className="h-4 w-4 mr-2" />Reason codes</TabsTrigger>
          <TabsTrigger value="packers"><Users className="h-4 w-4 mr-2" />Packers</TabsTrigger>
        </TabsList>

        <TabsContent value="carriers">
          <CarriersTab carriers={carriers} onChange={load} loading={loading} />
        </TabsContent>
        <TabsContent value="reasons">
          <ReasonsTab reasons={reasons} carriers={carriers} onChange={load} loading={loading} />
        </TabsContent>
        <TabsContent value="packers">
          <PackersTab packers={packers} onChange={load} loading={loading} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

// ---------------- Carriers ----------------
const CarriersTab = ({ carriers, onChange, loading }: { carriers: Carrier[]; onChange: () => void; loading: boolean }) => {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Carrier | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", active: true });

  const startNew = () => { setEditing(null); setForm({ name: "", slug: "", active: true }); setOpen(true); };
  const startEdit = (c: Carrier) => { setEditing(c); setForm({ name: c.name, slug: c.slug, active: c.active }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim() || !form.slug.trim()) { toast.error("Name and slug required"); return; }
    const payload = { name: form.name.trim(), slug: form.slug.trim().toLowerCase(), active: form.active };
    const res = editing
      ? await supabase.from("carriers").update(payload).eq("id", editing.id)
      : await supabase.from("carriers").insert(payload);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(editing ? "Carrier updated" : "Carrier added");
    setOpen(false); onChange();
  };

  const remove = async (c: Carrier) => {
    if (!confirm(`Delete carrier "${c.name}"? This will not delete documents.`)) return;
    const { error } = await supabase.from("carriers").delete().eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Carrier deleted"); onChange();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Carriers</CardTitle>
          <CardDescription>Couriers that issue invoices or penalty notices.</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startNew} variant="outline"><Plus className="h-4 w-4 mr-2" />Add carrier</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit carrier" : "Add carrier"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Royal Mail" /></div>
              <div className="space-y-2"><Label>Slug</Label><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="royal-mail" /></div>
              <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /></div>
            </div>
            <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Slug</TableHead><TableHead>Active</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && carriers.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No carriers yet.</TableCell></TableRow>}
            {carriers.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.slug}</TableCell>
                <TableCell>{c.active ? "Yes" : "No"}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(c)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

// ---------------- Reasons ----------------
const ReasonsTab = ({ reasons, carriers, onChange, loading }: { reasons: ReasonCode[]; carriers: Carrier[]; onChange: () => void; loading: boolean }) => {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReasonCode | null>(null);
  const [form, setForm] = useState<{ carrier_id: string | null; code: string; label: string; description: string; active: boolean }>({ carrier_id: null, code: "", label: "", description: "", active: true });

  const startNew = () => { setEditing(null); setForm({ carrier_id: carriers[0]?.id ?? null, code: "", label: "", description: "", active: true }); setOpen(true); };
  const startEdit = (r: ReasonCode) => { setEditing(r); setForm({ carrier_id: r.carrier_id, code: r.code, label: r.label, description: r.description ?? "", active: r.active }); setOpen(true); };

  const save = async () => {
    if (!form.code.trim() || !form.label.trim()) { toast.error("Code and label required"); return; }
    const payload = { carrier_id: form.carrier_id, code: form.code.trim(), label: form.label.trim(), description: form.description.trim() || null, active: form.active };
    const res = editing
      ? await supabase.from("carrier_reason_codes" as any).update(payload).eq("id", editing.id)
      : await supabase.from("carrier_reason_codes" as any).insert(payload);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(editing ? "Reason updated" : "Reason added");
    setOpen(false); onChange();
  };

  const remove = async (r: ReasonCode) => {
    if (!confirm(`Delete reason "${r.code}"?`)) return;
    const { error } = await supabase.from("carrier_reason_codes" as any).delete().eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Reason deleted"); onChange();
  };

  const carrierName = (id: string | null) => carriers.find((c) => c.id === id)?.name ?? "All carriers";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Reason codes</CardTitle>
          <CardDescription>Friendly labels for raw codes that appear on invoices (e.g. "OS" → "Oversize package").</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startNew} variant="outline"><Plus className="h-4 w-4 mr-2" />Add reason</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit reason code" : "Add reason code"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Carrier</Label>
                <Select value={form.carrier_id ?? "all"} onValueChange={(v) => setForm({ ...form, carrier_id: v === "all" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All carriers</SelectItem>
                    {carriers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="OS" /></div>
              <div className="space-y-2"><Label>Label</Label><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Oversize package" /></div>
              <div className="space-y-2"><Label>Description (optional)</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /></div>
            </div>
            <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Label</TableHead><TableHead>Carrier</TableHead><TableHead>Active</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && reasons.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No reason codes yet. The AI parser will tag penalties with raw codes; add labels here to translate them.</TableCell></TableRow>}
            {reasons.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-sm">{r.code}</TableCell>
                <TableCell className="font-medium">{r.label}</TableCell>
                <TableCell className="text-muted-foreground">{carrierName(r.carrier_id)}</TableCell>
                <TableCell>{r.active ? "Yes" : "No"}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

// ---------------- Packers ----------------
const PackersTab = ({ packers, onChange, loading }: { packers: Packer[]; onChange: () => void; loading: boolean }) => {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Packer | null>(null);
  const [form, setForm] = useState({ name: "", email: "", active: true, notes: "" });

  const startNew = () => { setEditing(null); setForm({ name: "", email: "", active: true, notes: "" }); setOpen(true); };
  const startEdit = (p: Packer) => { setEditing(p); setForm({ name: p.name, email: p.email ?? "", active: p.active, notes: p.notes ?? "" }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    const payload = { name: form.name.trim(), email: form.email.trim() || null, active: form.active, notes: form.notes.trim() || null };
    const res = editing
      ? await supabase.from("carrier_packers" as any).update(payload).eq("id", editing.id)
      : await supabase.from("carrier_packers" as any).insert(payload);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(editing ? "Packer updated" : "Packer added");
    setOpen(false); onChange();
  };

  const remove = async (p: Packer) => {
    if (!confirm(`Remove packer "${p.name}" from the roster?`)) return;
    const { error } = await supabase.from("carrier_packers" as any).delete().eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Packer removed"); onChange();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Packer roster</CardTitle>
          <CardDescription>Names available when assigning remeasure tasks in the worklist.</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startNew} variant="outline"><Plus className="h-4 w-4 mr-2" />Add packer</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit packer" : "Add packer"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Email (optional)</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="space-y-2"><Label>Notes (optional)</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /></div>
            </div>
            <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Active</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && packers.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No packers on the roster yet.</TableCell></TableRow>}
            {packers.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-muted-foreground">{p.email ?? "—"}</TableCell>
                <TableCell>{p.active ? "Yes" : "No"}</TableCell>
                <TableCell className="text-muted-foreground text-sm max-w-md truncate">{p.notes ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(p)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(p)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default CarrierSettings;
