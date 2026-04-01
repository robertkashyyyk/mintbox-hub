import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { EnrichedOrderLine } from "@/hooks/useOrderTelemetry";

interface OrderTableProps {
  lines: EnrichedOrderLine[];
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (s: number) => void;
  totalPages: number;
  totalFiltered: number;
  onRowClick: (line: EnrichedOrderLine) => void;
}

function OrderStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const normalized = status.toUpperCase();
  const styles: Record<string, string> = {
    NEW: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "AWAITING PICKING": "bg-amber-500/15 text-amber-400 border-amber-500/30",
    "ON BACK ORDER": "bg-purple-500/15 text-purple-400 border-purple-500/30",
    DESPATCHED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    DISPATCHED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    CANCELLED: "bg-muted text-muted-foreground border-border",
    PICKED: "bg-teal-500/15 text-teal-400 border-teal-500/30",
  };
  return (
    <Badge variant="outline" className={`text-xs whitespace-nowrap ${styles[normalized] || "bg-secondary text-secondary-foreground"}`}>
      {status}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    watch: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    problem: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={colors[severity] || ""}>
      {severity}
    </Badge>
  );
}

function IssueStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-red-500/10 text-red-400 border-red-500/20",
    in_review: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    waiting_stock: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    waiting_supplier: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    resolved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    auto_resolved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    ignored: "bg-muted text-muted-foreground border-border",
  };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Badge variant="outline" className={colors[status] || ""}>
      {label}
    </Badge>
  );
}

function ProblemTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    new_stuck: "New Stuck",
    stalled_progress: "Stalled",
    repeated_snapshot: "Repeated",
    stock_discrepancy_suspected: "Stock Issue",
  };
  return (
    <Badge variant="secondary" className="text-xs">
      {labels[type] || type}
    </Badge>
  );
}

export default function OrderTable({
  lines,
  page,
  setPage,
  pageSize,
  setPageSize,
  totalPages,
  totalFiltered,
  onRowClick,
}: OrderTableProps) {
  return (
    <div className="space-y-2">
      {/* Pagination header */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {totalFiltered} results · Page {page} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          <span>Per page:</span>
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => {
              setPageSize(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[50, 100, 250, 500, 1000].map((n) => (
                <SelectItem key={n} value={n.toString()}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Order ID</TableHead>
              <TableHead className="w-12">Line</TableHead>
              <TableHead className="w-24">Order Date</TableHead>
              <TableHead className="w-16">Age (h)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="w-12 text-right">Qty</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead className="w-12">Seen</TableHead>
              <TableHead>Problem</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Issue</TableHead>
              <TableHead>Assigned</TableHead>
              <TableHead className="w-28">Last Seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={16} className="text-center py-8 text-muted-foreground">
                  No order lines match the current filters
                </TableCell>
              </TableRow>
            ) : (
              lines.map((line) => (
                <TableRow
                  key={`${line.mintsoft_order_id}-${line.line_index}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onRowClick(line)}
                >
                  <TableCell className="font-medium">{line.mintsoft_order_id}</TableCell>
                  <TableCell>{line.line_index}</TableCell>
                  <TableCell className="text-xs">
                    {new Date(line.order_date).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{line.age_hours}</TableCell>
                  <TableCell><OrderStatusBadge status={line.order_status} /></TableCell>
                  <TableCell className="text-xs">{line.brands?.name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{line.sku}</TableCell>
                  <TableCell className="text-xs max-w-[160px] truncate">
                    {line.product_name || "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">{line.qty}</TableCell>
                  <TableCell className="text-xs">{line.channel || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{line.times_seen || 1}</TableCell>
                  <TableCell>
                    {line.issue ? <ProblemTypeBadge type={line.issue.problem_type} /> : null}
                  </TableCell>
                  <TableCell>
                    {line.issue ? <SeverityBadge severity={line.issue.severity} /> : null}
                  </TableCell>
                  <TableCell>
                    {line.issue ? <IssueStatusBadge status={line.issue.issue_status} /> : null}
                  </TableCell>
                  <TableCell className="text-xs">{line.issue?.assigned_to || ""}</TableCell>
                  <TableCell className="text-xs">
                    {line.last_seen_at
                      ? new Date(line.last_seen_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-1">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
