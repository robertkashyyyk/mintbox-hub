import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { BaseSkuAutocomplete } from "./BaseSkuAutocomplete";
import { isValidBaseSku } from "@/hooks/useSkuTransformations";

export interface RuleDialogProps {
  open: boolean;
  onClose: () => void;
  kind: "conversion" | "multiplier";
  initial?: any;
  onSave: (rule: any) => Promise<void>;
}

export function RuleDialog({ open, onClose, kind, initial, onSave }: RuleDialogProps) {
  const isConv = kind === "conversion";
  const sourceField = isConv ? "procurement_sku" : "multiplier_sku";
  const multField = isConv ? "conversion_multiplier" : "multiplier_qty";

  const [sourceSku, setSourceSku] = useState("");
  const [baseSku, setBaseSku] = useState("");
  const [mult, setMult] = useState<number | "">("");
  const [autoConvert, setAutoConvert] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setSourceSku(initial?.[sourceField] ?? "");
      setBaseSku(initial?.base_sku ?? "");
      setMult(initial?.[multField] ?? "");
      setAutoConvert(initial?.auto_convert_on_receipt ?? true);
      setIsActive(initial?.is_active ?? true);
      setNotes(initial?.notes ?? "");
    }
  }, [open, initial, sourceField, multField]);

  const onSubmit = async () => {
    if (!sourceSku.trim()) return toast({ title: "Source SKU required", variant: "destructive" });
    if (!baseSku.trim()) return toast({ title: "Base SKU required", variant: "destructive" });
    if (sourceSku.trim() === baseSku.trim())
      return toast({ title: "Source SKU cannot point to itself", variant: "destructive" });
    const m = typeof mult === "number" ? mult : parseFloat(String(mult));
    if (!m || m <= 0) return toast({ title: "Multiplier must be greater than 0", variant: "destructive" });

    const okBase = await isValidBaseSku(baseSku.trim());
    if (!okBase) {
      return toast({
        title: "Base SKU not found",
        description: "The base SKU must already exist as a BASE row in SKU Logic.",
        variant: "destructive",
      });
    }

    setSaving(true);
    try {
      const payload: any = {
        id: initial?.id,
        [sourceField]: sourceSku.trim(),
        base_sku: baseSku.trim(),
        [multField]: m,
        is_active: isActive,
        notes: notes.trim() || null,
      };
      if (isConv) payload.auto_convert_on_receipt = autoConvert;
      await onSave(payload);
      toast({ title: initial?.id ? "Rule updated" : "Rule created" });
      onClose();
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initial?.id ? "Edit" : "New"} {isConv ? "conversion" : "multiplier"} rule
          </DialogTitle>
          <DialogDescription>
            {isConv
              ? "Procurement SKU → Base SKU × multiplier (e.g. FA1-756.521.100 → FA1-756.521 × 100)"
              : "Multiplier SKU → Base SKU × qty (e.g. FA1-756.521-M20 → FA1-756.521 × 20)"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>{isConv ? "Procurement SKU" : "Multiplier SKU"}</Label>
            <Input
              value={sourceSku}
              onChange={(e) => setSourceSku(e.target.value)}
              placeholder="Source SKU"
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label>Base SKU</Label>
            <BaseSkuAutocomplete value={baseSku} onChange={setBaseSku} />
          </div>
          <div className="space-y-1">
            <Label>{isConv ? "Conversion multiplier" : "Multiplier qty"}</Label>
            <Input
              type="number"
              min={1}
              value={mult}
              onChange={(e) => setMult(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>

          {isConv && (
            <div className="flex items-center justify-between rounded-md border border-border p-2">
              <div>
                <p className="text-sm">Auto-convert on receipt</p>
                <p className="text-[11px] text-muted-foreground">
                  Phase 3 will flip stock when received. Setting now is safe and inactive.
                </p>
              </div>
              <Switch checked={autoConvert} onCheckedChange={setAutoConvert} />
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border border-border p-2">
            <p className="text-sm">Active</p>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
