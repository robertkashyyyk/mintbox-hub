import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  fetchMappingSuggestions, type MappingSuggestion,
} from "@/hooks/useSkuTransformations";

interface Props { open: boolean; onClose: () => void; }

export function SuggestMappingsDialog({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<MappingSuggestion[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setLoading(true);
    fetchMappingSuggestions()
      .then((s) => setSuggestions(s))
      .catch((e) => toast({ title: "Scan failed", description: e?.message, variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [open, toast]);

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const createSelected = async () => {
    if (picked.size === 0) return;
    setSaving(true);
    const convRows: any[] = [];
    const multRows: any[] = [];
    for (const s of suggestions) {
      const key = `${s.source_sku}|${s.inferred_type}`;
      if (!picked.has(key)) continue;
      if (s.inferred_type === "PROCUREMENT_PACK") {
        convRows.push({
          procurement_sku: s.source_sku,
          base_sku: s.inferred_base_sku,
          conversion_multiplier: s.multiplier,
          auto_convert_on_receipt: false,
          is_active: true,
        });
      } else {
        multRows.push({
          multiplier_sku: s.source_sku,
          base_sku: s.inferred_base_sku,
          multiplier_qty: s.multiplier,
          is_active: true,
        });
      }
    }
    try {
      if (convRows.length) {
        const { error } = await supabase.from("sku_conversion_rules").insert(convRows);
        if (error) throw error;
      }
      if (multRows.length) {
        const { error } = await supabase.from("sku_multiplier_rules").insert(multRows);
        if (error) throw error;
      }
      toast({ title: `Created ${convRows.length + multRows.length} rules` });
      qc.invalidateQueries({ queryKey: ["sku-transformations"] });
      onClose();
    } catch (e: any) {
      toast({ title: "Insert failed", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Suggested mappings from SKU suffix patterns</DialogTitle>
          <DialogDescription>
            Patterns like <code>.100</code>, <code>-P100</code>, <code>-M20</code>, <code>-Q02</code> are scanned for
            candidates. Nothing is created until you tick rows and confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
          {loading && <p className="p-4 text-sm text-muted-foreground">Scanning…</p>}
          {!loading && suggestions.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No suffix-based candidates found.</p>
          )}
          {!loading && suggestions.map((s) => {
            const key = `${s.source_sku}|${s.inferred_type}`;
            return (
              <label
                key={key}
                className={`flex items-center gap-3 border-b border-border p-2 last:border-0 ${
                  s.base_exists ? "hover:bg-muted/30 cursor-pointer" : "opacity-50"
                }`}
              >
                <Checkbox
                  checked={picked.has(key)}
                  disabled={!s.base_exists}
                  onCheckedChange={() => toggle(key)}
                />
                <Badge variant="outline" className="font-mono text-[10px]">{s.pattern}</Badge>
                <span className="font-mono text-xs">{s.source_sku}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-xs">{s.inferred_base_sku}</span>
                <span className="text-muted-foreground">×</span>
                <span className="font-mono text-xs">{s.multiplier}</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">{s.inferred_type}</Badge>
                {!s.base_exists && (
                  <span className="text-[10px] text-warning">base SKU not found</span>
                )}
              </label>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={createSelected} disabled={saving || picked.size === 0}>
            {saving ? "Creating…" : `Create ${picked.size} selected`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
