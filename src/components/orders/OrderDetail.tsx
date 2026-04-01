import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { X, AlertTriangle, Clock, Eye, ShieldOff } from "lucide-react";
import type { EnrichedOrderLine } from "@/hooks/useOrderTelemetry";

interface OrderDetailProps {
  line: EnrichedOrderLine | null;
  onClose: () => void;
}

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

        <div className="space-y-6 mt-6">
          {/* Order Info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Order Date</span>
              <p className="font-medium">{new Date(line.order_date).toLocaleString()}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Age</span>
              <p className="font-medium">{line.age_hours}h</p>
            </div>
            <div>
              <span className="text-muted-foreground">Status</span>
              <p className="font-medium">{line.order_status || "Unknown"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Status Age</span>
              <p className="font-medium">{statusAgeHours != null ? `${statusAgeHours}h` : "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Brand</span>
              <p className="font-medium">{line.brands?.name || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Channel</span>
              <p className="font-medium">{line.channel || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Qty</span>
              <p className="font-medium">{line.qty}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Times Seen</span>
              <p className="font-medium">{line.times_seen || 1}</p>
            </div>
            <div>
              <span className="text-muted-foreground">First Seen</span>
              <p className="font-medium text-xs">
                {line.first_seen_at ? new Date(line.first_seen_at).toLocaleString() : "—"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Last Seen</span>
              <p className="font-medium text-xs">
                {line.last_seen_at ? new Date(line.last_seen_at).toLocaleString() : "—"}
              </p>
            </div>
          </div>

          {/* Issue Section */}
          {line.issue ? (
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="font-semibold">Issue Detected</span>
              </div>

              <div className="bg-muted/50 rounded-md p-3 space-y-2 text-sm">
                <p><strong>Type:</strong> {line.issue.problem_type.replace(/_/g, " ")}</p>
                <p><strong>Severity:</strong> {line.issue.severity}</p>
                <p><strong>Reason:</strong> {line.issue.reason || "—"}</p>
                <p><strong>Status:</strong> {line.issue.issue_status.replace(/_/g, " ")}</p>
                {line.issue.assigned_to && <p><strong>Assigned:</strong> {line.issue.assigned_to}</p>}
                {line.issue.is_suppressed && (
                  <p className="text-amber-400">
                    <ShieldOff className="inline h-3 w-3 mr-1" />
                    Suppressed: {line.issue.suppression_reason}
                  </p>
                )}
              </div>

              {/* Issue Status Control */}
              <div className="space-y-2">
                <Label>Update Issue Status</Label>
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
                <Input
                  placeholder="Assign to..."
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                  className="flex-1"
                />
                <Button size="sm" onClick={handleAssign} disabled={!assignTo.trim()}>
                  Assign
                </Button>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label>Add Note</Label>
                <Textarea
                  placeholder="Internal notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
                <Button size="sm" variant="outline" onClick={handleAddNotes} disabled={!notes.trim()}>
                  Add Note
                </Button>
                {line.issue.internal_notes && (
                  <div className="bg-muted/30 rounded p-2 text-xs whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {line.issue.internal_notes}
                  </div>
                )}
              </div>

              {/* Resolve */}
              <div className="space-y-2">
                <Label>Resolve</Label>
                <div className="flex flex-wrap gap-1.5">
                  {["stock_corrected", "backordered", "supplier_ordered", "order_cancelled", "false_alarm"].map(
                    (type) => (
                      <Button
                        key={type}
                        size="sm"
                        variant="outline"
                        onClick={() => handleResolve(type)}
                      >
                        {type.replace(/_/g, " ")}
                      </Button>
                    )
                  )}
                </div>
              </div>

              {/* Suppress */}
              <div className="space-y-2 border-t pt-3">
                <Label className="flex items-center gap-1">
                  <ShieldOff className="h-3 w-3" /> Suppress
                </Label>
                <Input
                  placeholder="Reason (e.g. waiting supplier)"
                  value={suppressReason}
                  onChange={(e) => setSuppressReason(e.target.value)}
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
