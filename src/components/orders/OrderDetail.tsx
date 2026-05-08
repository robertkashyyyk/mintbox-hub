import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { AlertCircle, Repeat, Clock, ShoppingCart, Boxes } from "lucide-react";
import type { OpenOrderLine } from "@/hooks/useOrderTelemetry";

interface OrderDetailProps {
  line: OpenOrderLine | null;
  onClose: () => void;
}

function StatusPill({ kind }: { kind: OpenOrderLine["problem_kind"] | null }) {
  if (!kind) return null;
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    unordered: { label: "Unordered", cls: "bg-destructive/15 text-destructive border-destructive/40", Icon: AlertCircle },
    bouncer: { label: "Bouncer", cls: "bg-orange-500/15 text-orange-400 border-orange-500/40", Icon: Repeat },
    chronic_backorder: { label: "Chronic Backorder", cls: "bg-purple-500/15 text-purple-400 border-purple-500/40", Icon: Clock },
  };
  const c = map[kind];
  if (!c) return null;
  return (
    <Badge variant="outline" className={`text-xs ${c.cls}`}>
      <c.Icon className="h-3 w-3 mr-1" />
      {c.label}
    </Badge>
  );
}

export default function OrderDetail({ line, onClose }: OrderDetailProps) {
  if (!line) return null;

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
          <div className="flex flex-wrap gap-2">
            <StatusPill kind={line.problem_kind} />
            <Badge variant="outline" className="text-xs">{line.order_status}</Badge>
            {line.on_active_po && (
              <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                <ShoppingCart className="h-3 w-3 mr-1" /> On active PO
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Order Date</span>
              <p className="font-medium">{new Date(line.order_date).toLocaleString()}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Order Age</span>
              <p className={`font-bold text-lg ${
                line.age_hours >= 48 ? "text-destructive" :
                line.age_hours >= 24 ? "text-warning" :
                line.age_hours >= 12 ? "text-amber-400" : ""
              }`}>{line.age_hours}h</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Brand</span>
              <p className="font-medium">{line.brand_name || "—"}</p>
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
              <span className="text-muted-foreground text-xs">Customer Ref</span>
              <p className="font-medium">{line.channel_order_ref || "—"}</p>
            </div>
          </div>

          <Separator />

          {/* Stock & PO */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Boxes className="h-3 w-3" />
              <span>Stock & PO</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground text-xs">Current Stock</span>
                <p className={`font-medium ${line.current_stock <= 0 ? "text-destructive" : ""}`}>{line.current_stock}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">On Order (PO)</span>
                <p className="font-medium">{line.on_order_qty}</p>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground text-xs">Active PO</span>
                <p className={`font-medium ${line.on_active_po ? "text-emerald-400" : "text-destructive"}`}>
                  {line.on_active_po ? "Yes — SKU is on a draft / sent PO" : "No active purchase order for this SKU"}
                </p>
              </div>
            </div>
          </div>

          {/* Bouncer */}
          {line.bounce_back_count > 0 && (
            <>
              <Separator />
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Repeat className="h-3 w-3" />
                  <span>Bounce History</span>
                </div>
                <p className="text-sm">
                  This order has bounced from <strong>Awaiting Picking</strong> back to <strong>New</strong>{" "}
                  <span className={`font-bold ${line.bounce_back_count >= 2 ? "text-orange-400" : ""}`}>
                    {line.bounce_back_count}
                  </span>{" "}
                  time{line.bounce_back_count === 1 ? "" : "s"}.
                </p>
                {line.bounce_back_count >= 2 && (
                  <p className="text-xs text-muted-foreground">
                    The system thinks stock exists but the warehouse keeps failing the pick. Check physical stock for {line.sku}.
                  </p>
                )}
              </div>
            </>
          )}

          {/* Backorder */}
          {line.days_on_backorder != null && (
            <>
              <Separator />
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Backorder</span>
                </div>
                <p className="text-sm">
                  On backorder for{" "}
                  <span className={`font-bold ${line.days_on_backorder >= 14 ? "text-destructive" : line.days_on_backorder >= 5 ? "text-warning" : ""}`}>
                    {line.days_on_backorder} day{line.days_on_backorder === 1 ? "" : "s"}
                  </span>.
                </p>
              </div>
            </>
          )}

          <Separator />
          <p className="text-xs text-muted-foreground">
            Detection runs against live order + stock state. Resolutions happen automatically once the order leaves the open-pipeline statuses or once a PO is raised.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
