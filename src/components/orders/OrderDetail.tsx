import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Clock, ShieldOff, Lightbulb, History } from "lucide-react";
import type { EnrichedOrderLine } from "@/hooks/useOrderTelemetry";

interface OrderDetailProps {
  line: EnrichedOrderLine | null;
  onClose: () => void;
}

const SUGGESTED_ACTIONS: Record<string, string> = {
  new_stuck: "Check warehouse for pick availability. If stock exists, investigate pick queue. If not, move to backorder.",
  stalled_progress: "Review order status in warehouse system. Check for pick failures or system blocks.",
  repeated_snapshot: "Order is repeatedly appearing without progress. Check for system or stock issue preventing fulfilment.",
  stock_discrepancy_suspected: "Multiple orders stuck on this SKU — verify physical stock count matches system. Consider stock adjustment.",
};

export default function OrderDetail({ line, onClose }: OrderDetailProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [assignTo, setAssignTo] = useState("");
  const [notes, setNotes] = useState("");
  const [suppressReason, setSuppressReason] = useState("");
  const [suppressHours, setSuppressHours] = useState("24");

  const updateIssueMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      if (!line?.issue?.id) throw new Error("No issue to update");
      const { error } = await supabase
        .from("order_issues")
        .update(updates)
        .eq("id", line.issue.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-issues"] });
      toast({ title: "Issue updated" });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  if (!line) return null;

  const handleResolve = (resolutionType: string) => {
    updateIssueMutation.mutate({
      issue_status: "resolved",
      resolved_at: new Date().toISOString(),
      resolution_type: resolutionType,
    });
  };

  const handleSuppress = () => {
    const until = new Date(Date.now() + Number(suppressHours) * 60 * 60 * 1000).toISOString();
    updateIssueMutation.mutate({
      is_suppressed: true,
      suppressed_until: until,
      suppression_reason: suppressReason || "Manually suppressed",
    });
  };

  const handleAssign = () => {
    if (!assignTo.trim()) return;
    updateIssueMutation.mutate({ assigned_to: assignTo.trim() });
  };

  const handleAddNotes = () => {
    if (!notes.trim()) return;
    const existingNotes = line.issue?.internal_notes || "";
    const timestamp = new Date().toLocaleString();
    const updated = existingNotes
      ? `${existingNotes}\n\n[${timestamp}] ${notes.trim()}`
      : `[${timestamp}] ${notes.trim()}`;
    updateIssueMutation.mutate({ internal_notes: updated });
    setNotes("");
  };

  const handleStatusChange = (status: string) => {
    updateIssueMutation.mutate({ issue_status: status });
  };

  const statusAgeHours = line.last_status_change_at
    ? Math.round((Date.now() - new Date(line.last_status_change_at).getTime()) / (1000 * 60 * 60))
    : null;

  const severityColors: Record<string, string> = {
    watch: "border-l-amber-500",
    problem: "border-l-orange-500",
    critical: "border-l-red-500",
  };

  return (
    <Sheet open={!!line} onOpenChange={() => onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Order {line.mintsoft_order_id} · Line {line.line_index}
          </SheetTitle>
          <SheetDescription>
            {line.sku} — {line.product_name || "Unknown Product"}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 mt-6">
          {/* Order Info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Order Date</span>
              <p className="font-medium">{new Date(line.order_date).toLocaleString()}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Order Age</span>
              <p className={`font-bold text-lg ${
                line.age_hours >= 48 ? "text-red-400" :
                line.age_hours >= 24 ? "text-orange-400" :
                line.age_hours >= 12 ? "text-amber-400" : ""
              }`}>{line.age_hours}h</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Status</span>
              <p className="font-medium">{line.order_status || "Unknown"}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Status Unchanged For</span>
              <p className="font-medium">{statusAgeHours != null ? `${statusAgeHours}h` : "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Brand</span>
              <p className="font-medium">{line.brands?.name || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Channel</span>
              <p className="font-medium">{line.channel || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Qty</span>
              <p className="font-medium">{line.qty}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Times Seen</span>
              <p className="font-medium">{line.times_seen || 1}</p>
            </div>
          </div>

          {/* SKU Signal */}
          {line.sku_problem_count >= 2 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-red-400">SKU appears in {line.sku_problem_count} problem orders</p>
                <p className="text-muted-foreground text-xs mt-0.5">This may indicate a stock integrity issue for <span className="font-mono">{line.sku}</span></p>
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <History className="h-3 w-3" />
              <span>Timeline</span>
            </div>
            <div className="pl-4 border-l-2 border-border space-y-1 text-xs">
              <div className="flex justify-between">
                <span>First seen</span>
                <span className="font-medium">{line.first_seen_at ? new Date(line.first_seen_at).toLocaleString() : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Last seen</span>
                <span className="font-medium">{line.last_seen_at ? new Date(line.last_seen_at).toLocaleString() : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Last status change</span>
                <span className="font-medium">{line.last_status_change_at ? new Date(line.last_status_change_at).toLocaleString() : "—"}</span>
              </div>
              {line.issue?.first_problem_seen_at && (
                <div className="flex justify-between text-orange-400">
                  <span>First flagged</span>
                  <span className="font-medium">{new Date(line.issue.first_problem_seen_at).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Issue Section */}
          {line.issue ? (
            <div className={`space-y-4 border-l-4 pl-3 ${severityColors[line.issue.severity] || "border-l-border"}`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="font-semibold">Issue Detected</span>
              </div>

              {/* Why flagged */}
              <div className="bg-muted/50 rounded-md p-3 space-y-2 text-sm">
                <p><strong>Type:</strong> {line.issue.problem_type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</p>
                <p><strong>Severity:</strong> <span className={
                  line.issue.severity === "critical" ? "text-red-400 font-bold" :
                  line.issue.severity === "problem" ? "text-orange-400 font-semibold" :
                  "text-amber-400"
                }>{line.issue.severity.toUpperCase()}</span></p>
                <div>
                  <strong>Why flagged:</strong>
                  <p className="text-muted-foreground mt-0.5">{line.issue.reason || "—"}</p>
                </div>
                <p><strong>Status:</strong> {line.issue.issue_status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</p>
                {line.issue.assigned_to && <p><strong>Assigned:</strong> {line.issue.assigned_to}</p>}
                {line.issue.is_suppressed && (
                  <p className="text-amber-400">
                    <ShieldOff className="inline h-3 w-3 mr-1" />
                    Suppressed: {line.issue.suppression_reason}
                  </p>
                )}
              </div>

              {/* Suggested Action */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3 flex items-start gap-2">
                <Lightbulb className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-blue-400">Suggested Action</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {line.issue.suggested_action || SUGGESTED_ACTIONS[line.issue.problem_type] || "Review order and take appropriate action."}
                  </p>
                </div>
              </div>

              {/* Issue Status Control */}
              <div className="space-y-2">
                <Label className="text-xs">Update Issue Status</Label>
                <Select value={line.issue.issue_status} onValueChange={handleStatusChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_review">In Review</SelectItem>
                    <SelectItem value="waiting_stock">Waiting Stock</SelectItem>
                    <SelectItem value="waiting_supplier">Waiting Supplier</SelectItem>
                    <SelectItem value="ignored">Ignored</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Assign */}
              <div className="flex gap-2">
                <Input placeholder="Assign to..." value={assignTo} onChange={e => setAssignTo(e.target.value)} className="flex-1" />
                <Button size="sm" onClick={handleAssign} disabled={!assignTo.trim()}>Assign</Button>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label className="text-xs">Add Note</Label>
                <Textarea placeholder="Internal notes..." value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
                <Button size="sm" variant="outline" onClick={handleAddNotes} disabled={!notes.trim()}>Add Note</Button>
                {line.issue.internal_notes && (
                  <div className="bg-muted/30 rounded p-2 text-xs whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {line.issue.internal_notes}
                  </div>
                )}
              </div>

              {/* Resolve */}
              <div className="space-y-2">
                <Label className="text-xs">Resolve</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { key: "stock_adjusted", label: "Stock Adjusted" },
                    { key: "moved_to_backorder", label: "Moved to Backorder" },
                    { key: "supplier_ordered", label: "Supplier Ordered" },
                    { key: "found_and_picked", label: "Found and Picked" },
                    { key: "false_positive", label: "False Positive" },
                    { key: "order_cancelled", label: "Order Cancelled" },
                  ].map(r => (
                    <Button key={r.key} size="sm" variant="outline" onClick={() => handleResolve(r.key)}>
                      {r.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Suppress */}
              <div className="space-y-2 border-t pt-3">
                <Label className="flex items-center gap-1 text-xs">
                  <ShieldOff className="h-3 w-3" /> Suppress (Quiet the noise)
                </Label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {["Known issue", "Waiting supplier", "Ignore for now"].map(reason => (
                    <Badge
                      key={reason}
                      variant={suppressReason === reason ? "default" : "secondary"}
                      className="cursor-pointer text-xs"
                      onClick={() => setSuppressReason(reason)}
                    >
                      {reason}
                    </Badge>
                  ))}
                </div>
                <Input
                  placeholder="Or type custom reason..."
                  value={suppressReason}
                  onChange={e => setSuppressReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Select value={suppressHours} onValueChange={setSuppressHours}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="12">12 hours</SelectItem>
                      <SelectItem value="24">24 hours</SelectItem>
                      <SelectItem value="48">48 hours</SelectItem>
                      <SelectItem value="168">7 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="secondary" onClick={handleSuppress}>
                    Suppress
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="border-t pt-4 text-sm text-muted-foreground">
              No issues detected for this order line.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
