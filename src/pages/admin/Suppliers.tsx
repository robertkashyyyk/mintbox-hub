import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface Supplier {
  id: string;
  name: string;
  contact_email: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  ordering_method: string | null;
  lead_time_days: number | null;
  mintsoft_supplier_id: number | null;
  active: boolean;
  notes: string | null;
}

const empty: Partial<Supplier> = {
  name: "", contact_email: "", contact_name: "", contact_phone: "",
  ordering_method: "email", lead_time_days: 7, mintsoft_supplier_id: null,
  active: true, notes: "",
};

interface Prefix {
  prefix: string;
  prefix_style: string | null;
  supplier_id: string | null;
  notes: string | null;
}
interface Brand {
  id: string;
  name: string;
  prefix: string;
  prefix_style: string | null;
}

const Suppliers = () => {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Supplier>>(empty);
  const [newPrefix, setNewPrefix] = useState<string>("");
  const [newPrefixStyle, setNewPrefixStyle] = useState<string>("hyphen");

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers-list"],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb.from("suppliers").select("*").order("name");
      if (error) throw error;
      return ((data || []) as unknown) as Supplier[];
    },
  });

  const { data: prefixes = [] } = useQuery({
    queryKey: ["sku-prefixes-all"],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb.from("sku_prefixes").select("*").order("prefix");
      if (error) throw error;
      return ((data || []) as unknown) as Prefix[];
    },
  });

  const { data: brands = [] } = useQuery({
    queryKey: ["brands-with-prefix"],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb.from("brands").select("id, name, prefix, prefix_style").order("name");
      if (error) throw error;
      return ((data || []) as unknown) as Brand[];
    },
  });

  const prefixCountBySupplier = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of prefixes) {
      if (!p.supplier_id) continue;
      map.set(p.supplier_id, (map.get(p.supplier_id) || 0) + 1);
    }
    return map;
  }, [prefixes]);

  const mappedPrefixes = useMemo(
    () => prefixes.filter((p) => p.supplier_id === editing.id),
    [prefixes, editing.id]
  );

  // Brand prefixes not yet mapped to ANY supplier (good candidates to add)
  const unmappedBrands = useMemo(() => {
    const used = new Set(prefixes.map((p) => p.prefix.toUpperCase()));
    return brands.filter((b) => b.prefix && !used.has(b.prefix.toUpperCase()));
  }, [brands, prefixes]);

  const addPrefix = useMutation({
    mutationFn: async () => {
      if (!editing.id || !newPrefix.trim()) throw new Error("Pick a prefix");
      const sb = supabase as any;
      const { error } = await sb.from("sku_prefixes").upsert({
        prefix: newPrefix.trim().toUpperCase(),
        prefix_style: newPrefixStyle,
        supplier_id: editing.id,
      }, { onConflict: "prefix" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Prefix mapped" });
      setNewPrefix("");
      qc.invalidateQueries({ queryKey: ["sku-prefixes-all"] });
    },
    onError: (e: any) => toast({ title: "Could not map prefix", description: e.message, variant: "destructive" }),
  });

  const removePrefix = useMutation({
    mutationFn: async (prefix: string) => {
      const sb = supabase as any;
      const { error } = await sb.from("sku_prefixes").delete().eq("prefix", prefix);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Mapping removed" });
      qc.invalidateQueries({ queryKey: ["sku-prefixes-all"] });
    },
    onError: (e: any) => toast({ title: "Remove failed", description: e.message, variant: "destructive" }),
  });

  const startEdit = (s?: Supplier) => {
    setEditing(s ? { ...s } : empty);
    setNewPrefix("");
    setNewPrefixStyle("hyphen");
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async (s: Partial<Supplier>) => {
      const sb = supabase as any;
      if (!s.name?.trim()) throw new Error("Name is required");
      const payload = {
        name: s.name.trim(),
        contact_email: s.contact_email || null,
        contact_name: s.contact_name || null,
        contact_phone: s.contact_phone || null,
        ordering_method: s.ordering_method || "email",
        lead_time_days: Number(s.lead_time_days) || 7,
        mintsoft_supplier_id: s.mintsoft_supplier_id ? Number(s.mintsoft_supplier_id) : null,
        active: !!s.active,
        notes: s.notes || null,
      };
      if (s.id) {
        const { error } = await sb.from("suppliers").update(payload).eq("id", s.id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from("suppliers").insert(payload).select("id").single();
        if (error) throw error;
        setEditing({ ...s, id: data.id });
      }
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      qc.invalidateQueries({ queryKey: ["suppliers-list"] });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Suppliers</h1>
          <p className="text-foreground/60">Vendors used to fulfil purchase orders.</p>
        </div>
        <Button variant="outline" onClick={() => startEdit()}>
          <Plus className="h-4 w-4" /> New supplier
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All suppliers ({suppliers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-6 text-center">Loading…</p>
          ) : suppliers.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center">No suppliers yet.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Lead time</TableHead>
                    <TableHead className="text-right">Prefixes</TableHead>
                    <TableHead className="text-right">Mintsoft ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        <div className="text-sm">{s.contact_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{s.contact_email || ""}</div>
                      </TableCell>
                      <TableCell className="capitalize">{s.ordering_method || "—"}</TableCell>
                      <TableCell className="text-right">{s.lead_time_days ?? "—"} d</TableCell>
                      <TableCell className="text-right">
                        {prefixCountBySupplier.get(s.id) ?? 0}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {s.mintsoft_supplier_id ?? "—"}
                      </TableCell>
                      <TableCell>
                        {s.active
                          ? <Badge variant="secondary">Active</Badge>
                          : <Badge variant="outline">Inactive</Badge>}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => startEdit(s)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing.id ? "Edit supplier" : "New supplier"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Contact name</Label>
                <Input value={editing.contact_name || ""} onChange={(e) => setEditing({ ...editing, contact_name: e.target.value })} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={editing.contact_email || ""} onChange={(e) => setEditing({ ...editing, contact_email: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input value={editing.contact_phone || ""} onChange={(e) => setEditing({ ...editing, contact_phone: e.target.value })} />
              </div>
              <div>
                <Label>Ordering method</Label>
                <select
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  value={editing.ordering_method || "email"}
                  onChange={(e) => setEditing({ ...editing, ordering_method: e.target.value })}
                >
                  <option value="email">Email</option>
                  <option value="portal">Portal</option>
                  <option value="api">API</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Lead time (days)</Label>
                <Input type="number" min={0} value={editing.lead_time_days ?? 7}
                  onChange={(e) => setEditing({ ...editing, lead_time_days: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Mintsoft Supplier ID</Label>
                <Input type="number" value={editing.mintsoft_supplier_id ?? ""}
                  onChange={(e) => setEditing({ ...editing, mintsoft_supplier_id: e.target.value ? Number(e.target.value) : null })} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={2} value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={!!editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
              <Label className="!mt-0">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => save.mutate(editing)} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Suppliers;
