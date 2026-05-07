import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Settings, Plus, X, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type Brand = { id: string; name: string; prefix: string | null };
type Profile = {
  brand_id: string;
  preferred_domains: string[];
  blocked_domains: string[];
  search_templates: string[];
  notes: string | null;
};
type Suggestion = { id: string; brand_id: string; kind: "domain" | "template"; value: string; success_count: number; promoted: boolean };

export default function ImageScoutBrandProfiles() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Brand | null>(null);

  const brandsQ = useQuery({
    queryKey: ["brands-with-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("id, name, prefix").order("name");
      if (error) throw error;
      return data as Brand[];
    },
  });

  const profilesQ = useQuery({
    queryKey: ["brand-image-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brand_image_profiles").select("*");
      if (error) throw error;
      return data as Profile[];
    },
  });

  const suggestionsQ = useQuery({
    queryKey: ["brand-image-suggestions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_image_profile_suggestions")
        .select("*")
        .eq("promoted", false)
        .order("success_count", { ascending: false });
      if (error) throw error;
      return data as Suggestion[];
    },
  });

  const profileByBrand = (id: string) => profilesQ.data?.find((p) => p.brand_id === id);
  const sugByBrand = (id: string) => (suggestionsQ.data ?? []).filter((s) => s.brand_id === id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6 text-primary" />
            Image Scout — Brand Profiles
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-brand retrieval rules: which domains to prefer/block, and which search templates to run.
          </p>
        </div>
        <Button variant="ghost" onClick={() => navigate("/discovery/image-scout")}>← Image Scout</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Brands</CardTitle>
          <CardDescription>Click a brand to edit its image-retrieval profile.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Preferred</TableHead>
                <TableHead>Blocked</TableHead>
                <TableHead>Templates</TableHead>
                <TableHead>Suggested</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brandsQ.data?.map((b) => {
                const p = profileByBrand(b.id);
                const s = sugByBrand(b.id);
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="font-mono text-xs">{b.prefix ?? "—"}</TableCell>
                    <TableCell>{p?.preferred_domains?.length ?? 0}</TableCell>
                    <TableCell>{p?.blocked_domains?.length ?? 0}</TableCell>
                    <TableCell>{p?.search_templates?.length ?? 0}</TableCell>
                    <TableCell>{s.length > 0 ? <Badge variant="secondary">{s.length}</Badge> : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditing(b)}>
                        {p ? "Edit" : "Create"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <ProfileEditor
          brand={editing}
          profile={profileByBrand(editing.id) ?? null}
          suggestions={sugByBrand(editing.id)}
          onClose={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["brand-image-profiles"] });
            qc.invalidateQueries({ queryKey: ["brand-image-suggestions"] });
          }}
        />
      )}
    </div>
  );
}

function ProfileEditor({
  brand,
  profile,
  suggestions,
  onClose,
}: {
  brand: Brand;
  profile: Profile | null;
  suggestions: Suggestion[];
  onClose: () => void;
}) {
  const [preferred, setPreferred] = useState<string[]>(profile?.preferred_domains ?? []);
  const [blocked, setBlocked] = useState<string[]>(profile?.blocked_domains ?? []);
  const [templates, setTemplates] = useState<string[]>(profile?.search_templates ?? []);
  const [notes, setNotes] = useState(profile?.notes ?? "");
  const [newPreferred, setNewPreferred] = useState("");
  const [newBlocked, setNewBlocked] = useState("");
  const [newTemplate, setNewTemplate] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("brand_image_profiles").upsert({
        brand_id: brand.id,
        preferred_domains: preferred,
        blocked_domains: blocked,
        search_templates: templates,
        notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile saved");
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const promoteSuggestion = async (s: Suggestion) => {
    if (s.kind === "domain" && !preferred.includes(s.value)) setPreferred([...preferred, s.value]);
    if (s.kind === "template" && !templates.includes(s.value)) setTemplates([...templates, s.value]);
    await supabase.from("brand_image_profile_suggestions").update({ promoted: true }).eq("id", s.id);
    toast.success(`Promoted ${s.kind}`);
  };

  const ChipList = ({ items, onRemove }: { items: string[]; onRemove: (i: number) => void }) => (
    <div className="flex flex-wrap gap-2">
      {items.length === 0 && <span className="text-xs text-muted-foreground">none</span>}
      {items.map((v, i) => (
        <Badge key={i} variant="secondary" className="gap-1">
          <span className="font-mono text-xs">{v}</span>
          <button onClick={() => onRemove(i)} className="hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{brand.name} — Image Profile</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div>
            <label className="text-sm font-medium">Preferred domains</label>
            <p className="text-xs text-muted-foreground mb-2">e.g. <code>autodoc.co.uk</code>, <code>meyle.com</code></p>
            <ChipList items={preferred} onRemove={(i) => setPreferred(preferred.filter((_, j) => j !== i))} />
            <div className="flex gap-2 mt-2">
              <Input value={newPreferred} onChange={(e) => setNewPreferred(e.target.value)} placeholder="domain.com" />
              <Button size="sm" onClick={() => { if (newPreferred.trim()) { setPreferred([...preferred, newPreferred.trim()]); setNewPreferred(""); } }}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Blocked domains</label>
            <p className="text-xs text-muted-foreground mb-2">Results from these domains are dropped.</p>
            <ChipList items={blocked} onRemove={(i) => setBlocked(blocked.filter((_, j) => j !== i))} />
            <div className="flex gap-2 mt-2">
              <Input value={newBlocked} onChange={(e) => setNewBlocked(e.target.value)} placeholder="ebay.com" />
              <Button size="sm" onClick={() => { if (newBlocked.trim()) { setBlocked([...blocked, newBlocked.trim()]); setNewBlocked(""); } }}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Search templates</label>
            <p className="text-xs text-muted-foreground mb-2">
              Variables: <code>{`{brand}`}</code>, <code>{`{part_number}`}</code>, <code>{`{sku}`}</code>
            </p>
            <ChipList items={templates} onRemove={(i) => setTemplates(templates.filter((_, j) => j !== i))} />
            <div className="flex gap-2 mt-2">
              <Input value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)} placeholder="{brand} {part_number} product image" />
              <Button size="sm" onClick={() => { if (newTemplate.trim()) { setTemplates([...templates, newTemplate.trim()]); setNewTemplate(""); } }}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {suggestions.length > 0 && (
            <div className="border rounded-md p-3 bg-muted/30">
              <h4 className="text-sm font-medium mb-2">Suggested additions (from successful retrievals)</h4>
              <div className="space-y-1">
                {suggestions.slice(0, 8).map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <div>
                      <Badge variant="outline" className="mr-2">{s.kind}</Badge>
                      <span className="font-mono text-xs">{s.value}</span>
                      <span className="text-xs text-muted-foreground ml-2">({s.success_count}×)</span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => promoteSuggestion(s)}>
                      <ArrowUp className="h-3 w-3 mr-1" /> Promote
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
