import { useEffect, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useUpsertSkuMaster, type SkuLogicRow, type SkuType,
} from "@/hooks/useSkuTransformations";
import { BaseSkuAutocomplete } from "./BaseSkuAutocomplete";

const TYPES: { value: SkuType; label: string; hint: string }[] = [
  { value: "BASE", label: "BASE", hint: "Warehouse truth — the real stock unit" },
  { value: "PROCUREMENT_PACK", label: "PROCUREMENT_PACK", hint: "Supplier ordering / receipt only — transient" },
  { value: "MULTIPLIER", label: "MULTIPLIER", hint: "Sellable SKU that resolves to N × base" },
  { value: "BUNDLE", label: "BUNDLE", hint: "Multiple different base SKUs sold together" },
  { value: "ALT", label: "ALT", hint: "Alias / legacy mapping to a base" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  row: SkuLogicRow | null;
}

export function SkuEditSheet({ open, onClose, row }: Props) {
  const [draft, setDraft] = useState<SkuLogicRow | null>(row);
  const { mutateAsync, isPending } = useUpsertSkuMaster();
  const { toast } = useToast();

  useEffect(() => setDraft(row), [row]);
  if (!draft) return null;

  const update = <K extends keyof SkuLogicRow>(k: K, v: SkuLogicRow[K]) =>
    setDraft({ ...draft, [k]: v });

  const onSave = async () => {
    try {
      await mutateAsync({
        sku: draft.sku,
        sku_type: draft.sku_type,
        base_sku: draft.base_sku || null,
        supplier_order_sku: draft.supplier_order_sku || null,
        internal_alias_sku: draft.internal_alias_sku || null,
        allow_marketplace_sale: draft.allow_marketplace_sale,
        allow_picking: draft.allow_picking,
        allow_stock_holding: draft.allow_stock_holding,
        auto_convert_on_receipt: draft.auto_convert_on_receipt,
        conversion_multiplier: draft.conversion_multiplier ?? null,
        procurement_pack_size: draft.procurement_pack_size ?? null,
        notes: draft.notes || null,
      });
      toast({ title: "SKU updated", description: draft.sku });
      onClose();
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  };

  const isBase = draft.sku_type === "BASE";
  const isPack = draft.sku_type === "PROCUREMENT_PACK";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono">{draft.sku}</SheetTitle>
          <SheetDescription>
            {draft.name ?? "—"}{draft.brand ? ` · ${draft.brand}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label>SKU Type</Label>
            <Select value={draft.sku_type} onValueChange={(v) => update("sku_type", v as SkuType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex flex-col">
                      <span className="font-mono text-xs">{t.label}</span>
                      <span className="text-[10px] text-muted-foreground">{t.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isBase && (
            <div className="space-y-2">
              <Label>Base SKU</Label>
              <BaseSkuAutocomplete
                value={draft.base_sku ?? ""}
                onChange={(v) => update("base_sku", v || null)}
              />
              <p className="text-xs text-muted-foreground">
                The true stock unit this SKU maps to.
              </p>
            </div>
          )}

          {isBase && (
            <div className="space-y-2">
              <Label>Procurement pack size (optional)</Label>
              <Input
                type="number"
                min={1}
                value={draft.procurement_pack_size ?? ""}
                onChange={(e) =>
                  update("procurement_pack_size", e.target.value ? Number(e.target.value) : null)
                }
              />
              <p className="text-xs text-muted-foreground">
                Used by buy recommendations to round to pack multiples.
              </p>
            </div>
          )}

          {isPack && (
            <div className="space-y-2">
              <Label>Conversion multiplier</Label>
              <Input
                type="number"
                min={1}
                value={draft.conversion_multiplier ?? ""}
                onChange={(e) =>
                  update("conversion_multiplier", e.target.value ? Number(e.target.value) : null)
                }
              />
              <p className="text-xs text-muted-foreground">
                1 pack received → N base units.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Supplier order SKU</Label>
              <Input
                value={draft.supplier_order_sku ?? ""}
                onChange={(e) => update("supplier_order_sku", e.target.value || null)}
                placeholder="Code we send to supplier"
              />
            </div>
            <div className="space-y-2">
              <Label>Internal alias SKU</Label>
              <Input
                value={draft.internal_alias_sku ?? ""}
                onChange={(e) => update("internal_alias_sku", e.target.value || null)}
                placeholder="Optional internal alias"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground">Behaviour flags</p>
            <ToggleRow
              label="Auto-convert on receipt"
              hint="PROCUREMENT_PACK only — flips stock into base SKU on goods-in."
              checked={draft.auto_convert_on_receipt}
              onChange={(v) => update("auto_convert_on_receipt", v)}
            />
            <ToggleRow
              label="Allow marketplace sale"
              hint="Channels are blocked from listing if false."
              checked={draft.allow_marketplace_sale}
              onChange={(v) => update("allow_marketplace_sale", v)}
            />
            <ToggleRow
              label="Allow picking"
              hint="Warehouse can pick this SKU."
              checked={draft.allow_picking}
              onChange={(v) => update("allow_picking", v)}
            />
            <ToggleRow
              label="Allow stock holding"
              hint="Long-term stock truth. PROCUREMENT is transient."
              checked={draft.allow_stock_holding}
              onChange={(v) => update("allow_stock_holding", v)}
            />
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              rows={3}
              value={draft.notes ?? ""}
              onChange={(e) => update("notes", e.target.value || null)}
            />
          </div>
        </div>

        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ToggleRow({ label, hint, checked, onChange }: {
  label: string; hint: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm">{label}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
