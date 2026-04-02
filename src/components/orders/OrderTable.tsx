import { useState } from "react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import type { EnrichedOrderLine, SortKey, SortDir } from "@/hooks/useOrderTelemetry";

interface OrderTableProps {
  lines: EnrichedOrderLine[];
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (s: number) => void;
  totalPages: number;
  totalFiltered: number;
  onRowClick: (line: EnrichedOrderLine) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  toggleSort: (key: SortKey) => void;
}

function SeverityBar({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    watch: "bg-amber-500",
    problem: "bg-orange-500",
    critical: "bg-red-500",
  };
  return <div className={`absolute left-0 top-0 bottom-0 w-1 ${colors[severity] || ""}`} />;
}

function OrderStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const normalized = status.toUpperCase();
  const styles: Record<string, string> = {
    NEW: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    AWAITINGPICKING: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    "AWAITING PICKING": "bg-amber-500/15 text-amber-400 border-amber-500/30",
    ONBACKORDER: "bg-purple-500/15 text-purple-400 border-purple-500/30",
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
    watch: "bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold",
    problem: "bg-orange-500/20 text-orange-300 border-orange-500/40 font-semibold",
    critical: "bg-red-500/25 text-red-300 border-red-500/50 font-bold animate-pulse",
  };
  const icons: Record<string, string> = {
    watch: "⚠",
    problem: "🔶",
    critical: "🔴",
  };
  return (
    <Badge variant="outline" className={colors[severity] || ""}>
      {icons[severity]} {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </Badge>
  );
}

function ProblemTypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; className: string }> = {
    new_stuck: { label: "New Stuck", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    stalled_progress: { label: "Stalled", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    repeated_snapshot: { label: "Repeated", className: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
    stock_discrepancy_suspected: { label: "Stock Issue", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  };
  const c = config[type] || { label: type, className: "bg-secondary text-secondary-foreground" };
  return (
    <Badge variant="outline" className={`text-xs ${c.className}`}>
      {c.label}
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
  const label = status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return (
    <Badge variant="outline" className={colors[status] || ""}>
      {label}
    </Badge>
  );
}

function SkuSignal({ count }: { count: number }) {
  if (count < 2) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <span className="inline-flex items-center gap-0.5 text-xs text-red-400 font-medium">
            <AlertTriangle className="h-3 w-3" />
            {count}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>This SKU appears in {count} problem orders</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SortIcon({ columnKey, sortKey, sortDir }: { columnKey: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (columnKey !== sortKey) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3 w-3 ml-1 text-primary" />
    : <ArrowDown className="h-3 w-3 ml-1 text-primary" />;
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
  sortKey,
  sortDir,
  toggleSort,
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
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-2 p-0"></TableHead>
              {([
                ["order", "Order", "w-20"],
                ["age", "Age", "w-16"],
                ["status", "Status", ""],
                ["sku", "SKU", ""],
                ["product", "Product", ""],
                ["qty", "Qty", "w-12 text-right"],
                ["problem", "Problem", ""],
                ["severity", "Severity", ""],
                ["reason", "Reason", "min-w-[220px]"],
                ["issue", "Issue", ""],
                ["assigned", "Assigned", ""],
                ["brand", "Brand", ""],
              ] as [SortKey, string, string][]).map(([key, label, cls]) => (
                <TableHead
                  key={key}
                  className={`${cls} cursor-pointer select-none hover:text-foreground transition-colors`}
                  onClick={() => toggleSort(key)}
                >
                  <span className="inline-flex items-center">
                    {label}
                    <SortIcon columnKey={key} sortKey={sortKey} sortDir={sortDir} />
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                  No order lines match the current filters
                </TableCell>
              </TableRow>
            ) : (
              lines.map((line) => (
                <TableRow
                  key={`${line.mintsoft_order_id}-${line.line_index}`}
                  className="cursor-pointer hover:bg-muted/50 relative"
                  onClick={() => onRowClick(line)}
                >
                  <TableCell className="p-0 relative">
                    {line.issue && <SeverityBar severity={line.issue.severity} />}
                  </TableCell>
                  <TableCell className="font-medium">
                    {line.mintsoft_order_id}
                    <span className="text-muted-foreground text-xs ml-1">/{line.line_index}</span>
                  </TableCell>
                  <TableCell>
                    <span className={`font-mono text-sm font-bold ${
                      line.age_hours >= 48 ? "text-red-400" :
                      line.age_hours >= 24 ? "text-orange-400" :
                      line.age_hours >= 12 ? "text-amber-400" : "text-muted-foreground"
                    }`}>
                      {line.age_hours}h
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <OrderStatusBadge status={line.order_status} />
                      {(line as any).was_backordered && (line as any).last_backordered_at &&
                        (Date.now() - new Date((line as any).last_backordered_at).getTime()) < 24 * 3600000 && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 bg-purple-500/10 text-purple-400 border-purple-500/20">
                          Recovered from BO
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-xs">{line.sku}</span>
                      <SkuSignal count={line.sku_problem_count} />
                    </div>
                  </TableCell>
                  <TableCell className="text-xs max-w-[140px] truncate">
                    {line.product_name || "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">{line.qty}</TableCell>
                  <TableCell>
                    {line.issue ? <ProblemTypeBadge type={line.issue.problem_type} /> : null}
                  </TableCell>
                  <TableCell>
                    {line.issue ? <SeverityBadge severity={line.issue.severity} /> : null}
                  </TableCell>
                  <TableCell className="text-xs max-w-[260px] text-muted-foreground whitespace-normal leading-snug">
                    {line.issue?.reason || ""}
                  </TableCell>
                  <TableCell>
                    {line.issue ? <IssueStatusBadge status={line.issue.issue_status} /> : null}
                  </TableCell>
                  <TableCell className="text-xs">{line.issue?.assigned_to || ""}</TableCell>
                  <TableCell className="text-xs">{line.brands?.name || "—"}</TableCell>
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
