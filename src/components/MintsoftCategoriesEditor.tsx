import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, X, Plus, Check } from "lucide-react";

type Props = {
  productId: string;
  categories: string[] | null | undefined;
};

/**
 * Renders the Mintsoft categories pulled from `/api/Product/{id}` as tags.
 * Lets staff edit them locally — note: edits are stored on products_cache
 * only. The next enrichment cycle will overwrite from Mintsoft.
 */
export function MintsoftCategoriesEditor({ productId, categories }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(categories ?? []);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(categories ?? []);
  }, [categories, editing]);

  const addTag = () => {
    const t = input.trim();
    if (!t) return;
    if (draft.includes(t)) { setInput(""); return; }
    setDraft([...draft, t]);
    setInput("");
  };

  const removeTag = (t: string) => setDraft(draft.filter((x) => x !== t));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("products_cache")
      .update({ mintsoft_categories: draft })
      .eq("id", productId);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Categories updated" });
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["product", productId] });
  };

  if (!editing) {
    const tags = categories ?? [];
    return (
      <div className="flex justify-between items-start">
        <span className="text-muted-foreground text-sm">Mintsoft Categories</span>
        <div className="flex flex-wrap gap-1 justify-end items-center max-w-[70%]">
          {tags.length > 0
            ? tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-xs">
                  {t}
                </Badge>
              ))
            : <span className="text-sm text-muted-foreground">—</span>}
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 ml-1"
            onClick={() => setEditing(true)}
            aria-label="Edit Mintsoft categories"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">Mintsoft Categories</span>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(false)} aria-label="Cancel">
            <X className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={save} disabled={saving} aria-label="Save">
            <Check className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {draft.map((t) => (
          <Badge key={t} variant="secondary" className="text-xs gap-1">
            {t}
            <button
              type="button"
              onClick={() => removeTag(t)}
              className="hover:text-destructive"
              aria-label={`Remove ${t}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-1">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addTag(); }
          }}
          placeholder="Add category…"
          className="h-8 text-xs"
        />
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={addTag} aria-label="Add">
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Edits are saved locally. The next Mintsoft enrichment will overwrite them.
      </p>
    </div>
  );
}
