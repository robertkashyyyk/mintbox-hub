import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useConversionRules, useMultiplierRules,
  useSaveConversionRule, useSaveMultiplierRule,
  useDeleteConversionRule, useDeleteMultiplierRule,
  useGlobalSafetyBuffer, useSetGlobalSafetyBuffer,
  useVirtualSkuStockList,
} from "@/hooks/useSkuTransformations";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RuleDialog } from "./RuleDialog";
import { SuggestMappingsDialog } from "./SuggestMappingsDialog";

export function RulesTab() {
  const { data: conv = [], isLoading: convLoading } = useConversionRules();
  const { data: mult = [], isLoading: multLoading } = useMultiplierRules();
  const { data: virtualStock = [] } = useVirtualSkuStockList();
  const { data: globalBuffer = 0 } = useGlobalSafetyBuffer();
  const setBuffer = useSetGlobalSafetyBuffer();
  const saveConv = useSaveConversionRule();
  const saveMult = useSaveMultiplierRule();
  const delConv = useDeleteConversionRule();
  const delMult = useDeleteMultiplierRule();
  const { toast } = useToast();

  const stockBySku = new Map(virtualStock.map((v) => [v.virtual_sku, v]));
  const [bufferDraft, setBufferDraft] = useState<number | "">("");
  useEffect(() => {
    if (typeof globalBuffer === "number") setBufferDraft(globalBuffer);
  }, [globalBuffer]);

  const [convDialog, setConvDialog] = useState<{ open: boolean; initial?: any }>({ open: false });
  const [multDialog, setMultDialog] = useState<{ open: boolean; initial?: any }>({ open: false });
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<
    { kind: "conv" | "mult"; id: string } | null
  >(null);

  const onConfirmDelete = async () => {
    if (!confirmDel) return;
    try {
      if (confirmDel.kind === "conv") await delConv.mutateAsync(confirmDel.id);
      else await delMult.mutateAsync(confirmDel.id);
      toast({ title: "Rule deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    } finally {
      setConfirmDel(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setSuggestOpen(true)}>
          <Sparkles className="h-4 w-4 mr-1" /> Suggest mappings
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Conversion rules</CardTitle>
            <p className="text-xs text-muted-foreground">
              procurement_sku → base_sku × conversion_multiplier
            </p>
          </div>
          <Button size="sm" onClick={() => setConvDialog({ open: true })}>
            <Plus className="h-4 w-4 mr-1" /> Add rule
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Procurement SKU</TableHead>
                <TableHead>Base SKU</TableHead>
                <TableHead>Multiplier</TableHead>
                <TableHead>Auto-convert</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {convLoading && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!convLoading && conv.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No conversion rules yet.</TableCell></TableRow>
              )}
              {conv.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.procurement_sku}</TableCell>
                  <TableCell className="font-mono text-xs">{r.base_sku}</TableCell>
                  <TableCell className="font-mono text-xs">× {r.conversion_multiplier}</TableCell>
                  <TableCell>{r.auto_convert_on_receipt ? <Badge variant="outline" className="bg-pd-accent/15 text-pd-accent border-pd-accent/40">on</Badge> : <Badge variant="outline">off</Badge>}</TableCell>
                  <TableCell>{r.is_active ? <Badge variant="outline" className="bg-pd-accent/15 text-pd-accent border-pd-accent/40">active</Badge> : <Badge variant="outline">inactive</Badge>}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">{r.notes ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setConvDialog({ open: true, initial: r })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setConfirmDel({ kind: "conv", id: r.id })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Multiplier rules</CardTitle>
            <p className="text-xs text-muted-foreground">
              multiplier_sku → base_sku × multiplier_qty
            </p>
          </div>
          <Button size="sm" onClick={() => setMultDialog({ open: true })}>
            <Plus className="h-4 w-4 mr-1" /> Add rule
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Multiplier SKU</TableHead>
                <TableHead>Base SKU</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {multLoading && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!multLoading && mult.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No multiplier rules yet.</TableCell></TableRow>
              )}
              {mult.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.multiplier_sku}</TableCell>
                  <TableCell className="font-mono text-xs">{r.base_sku}</TableCell>
                  <TableCell className="font-mono text-xs">× {r.multiplier_qty}</TableCell>
                  <TableCell>{r.is_active ? <Badge variant="outline" className="bg-pd-accent/15 text-pd-accent border-pd-accent/40">active</Badge> : <Badge variant="outline">inactive</Badge>}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">{r.notes ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setMultDialog({ open: true, initial: r })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setConfirmDel({ kind: "mult", id: r.id })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RuleDialog
        open={convDialog.open}
        initial={convDialog.initial}
        kind="conversion"
        onClose={() => setConvDialog({ open: false })}
        onSave={(r) => saveConv.mutateAsync(r)}
      />
      <RuleDialog
        open={multDialog.open}
        initial={multDialog.initial}
        kind="multiplier"
        onClose={() => setMultDialog({ open: false })}
        onSave={(r) => saveMult.mutateAsync(r)}
      />
      <SuggestMappingsDialog open={suggestOpen} onClose={() => setSuggestOpen(false)} />

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the rule. Operational logic in Phase 3 will no longer use it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
