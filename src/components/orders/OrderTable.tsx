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
import {
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Repeat,
  ShoppingCart,
  AlertCircle,
} from "lucide-react";
import type { OpenOrderLine, SortKey, SortDir } from "@/hooks/useOrderTelemetry";

interface OrderTableProps {
  lines: OpenOrderLine[];
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (s: number) => void;
  totalPages: number;
  totalFiltered: number;
  onRowClick: (line: OpenOrderLine) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  toggleSort: (key: SortKey) => void;
}

function OrderStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const normalized = status.toUpperCase();
  const styles: Record<string, string> = {
    NEW: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    AWAITINGPICKING: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    ONBACKORDER: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    PICKED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  };
  const labels: Record<string, string> = {
    AWAITINGPICKING: "AWAITING PICKING",
    PICKED: "AWAITING PICKING",
  };
  return (
    <Badge variant="outline" className={`text-xs whitespace-nowrap ${styles[normalized] || ""}`}>
      {labels[normalized] || status}
    </Badge>
  );
}

function BouncerBadge({ count }: { count: number }) {
  if (count < 1) return <span className="text-muted-foreground text-xs">—</span>;
  const isBouncer = count >= 2;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold ${
              isBouncer ? "text-orange-400" : "text-muted-foreground"
            }`}
          >
            <Repeat className={`h-3 w-3 ${isBouncer ? "" : "opacity-60"}`} />
            {count}×
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            Order has bounced from Awaiting Picking back to New {count} time{count === 1 ? "" : "s"}.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PoStatusBadge({ line }: { line: OpenOrderLine }) {
  if (line.on_active_po) {
    return (
      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
        <ShoppingCart className="h-3 w-3 mr-1" /> On PO
      </Badge>
    );
  }
  if (line.current_stock > 0) {
    return <span className="text-muted-foreground text-xs">In stock</span>;
  }
  return (
    <Badge variant="outline" className="text-xs bg-destructive/15 text-destructive border-destructive/40">
      <AlertCircle className="h-3 w-3 mr-1" /> Not on PO
    </Badge>
  );
}

function BackorderDays({ days }: { days: number | null }) {
  if (days == null) return <span className="text-muted-foreground text-xs">—</span>;
  const cls = days >= 14 ? "text-destructive font-bold" : days >= 5 ? "text-warning font-semibold" : "text-foreground";
  return <span className={`font-mono text-xs ${cls}`}>{days}d</span>;
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
  const columns: [SortKey, string, string][] = [
    ["order", "Order", "w-24"],
    ["age", "Age", "w-16"],
    ["status", "Status", ""],
    ["sku", "SKU", ""],
    ["product", "Product", ""],
    ["qty", "Qty", "w-12 text-right"],
    ["bouncer", "Bouncer", "w-20"],
    ["backorder_days", "BO Days", "w-20"],
    // PO column is not sortable in this view; treat as static
    ["brand", "Brand", ""],
    ["channel", "Channel", ""],
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{totalFiltered} results · Page {page} of {totalPages}</span>
        <div className="flex items-center gap-2">
          <span>Per page:</span>
          <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[50, 100, 250, 500].map((n) => (
                <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
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

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map(([key, label, cls]) => (
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
              <TableHead>PO Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="text-center py-8 text-muted-foreground">
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
                  <TableCell className="font-medium">
                    {line.mintsoft_order_id}
                    <span className="text-muted-foreground text-xs ml-1">/{line.line_index}</span>
                  </TableCell>
                  <TableCell>
                    <span className={`font-mono text-sm font-bold ${
                      line.age_hours >= 48 ? "text-destructive" :
                      line.age_hours >= 24 ? "text-warning" :
                      line.age_hours >= 12 ? "text-amber-400" : "text-muted-foreground"
                    }`}>
                      {line.age_hours}h
                    </span>
                  </TableCell>
                  <TableCell><OrderStatusBadge status={line.order_status} /></TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{line.sku}</span>
                  </TableCell>
                  <TableCell className="text-xs max-w-[180px] truncate">{line.product_name || "—"}</TableCell>
                  <TableCell className="text-right font-medium">{line.qty}</TableCell>
                  <TableCell><BouncerBadge count={line.bounce_back_count} /></TableCell>
                  <TableCell><BackorderDays days={line.days_on_backorder} /></TableCell>
                  <TableCell className="text-xs">{line.brand_name || "—"}</TableCell>
                  <TableCell className="text-xs">{line.channel || "—"}</TableCell>
                  <TableCell><PoStatusBadge line={line} /></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-1">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
