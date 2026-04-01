import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { OrderFiltersState, SavedView } from "@/hooks/useOrderTelemetry";

interface OrderFiltersProps {
  filters: OrderFiltersState;
  setFilters: (f: OrderFiltersState) => void;
  applySavedView: (v: SavedView) => void;
  filterOptions: {
    brands: string[];
    channels: string[];
    warehouses: string[];
    statuses: string[];
  };
}

const savedViews: { key: SavedView; label: string; color?: string }[] = [
  { key: "needs_action", label: "⚡ Needs Action Now", color: "bg-orange-500/20 text-orange-300 border-orange-500/40" },
  { key: "all", label: "All Orders" },
  { key: "problems", label: "Problem Orders" },
  { key: "critical", label: "🔴 Critical" },
  { key: "repeated", label: "Repeated" },
  { key: "new_12h", label: "New > 12h" },
  { key: "new_24h", label: "New > 24h" },
  { key: "stock_issues", label: "Stock Issues" },
];

const toggleChips: { key: keyof OrderFiltersState; label: string }[] = [
  { key: "problemOnly", label: "Problem Orders Only" },
  { key: "openOnly", label: "Open Issues Only" },
  { key: "criticalOnly", label: "Critical Only" },
  { key: "repeatedOnly", label: "Repeated" },
  { key: "newStuckOnly", label: "New Stuck" },
  { key: "unassignedOnly", label: "Unassigned" },
  { key: "stockIssueOnly", label: "Likely Stock Issue" },
];

const statusChips = ["New", "Awaiting Picking", "On Back Order", "Despatched", "Cancelled"];

export default function OrderFilters({
  filters,
  setFilters,
  applySavedView,
  filterOptions,
}: OrderFiltersProps) {
  const [expanded, setExpanded] = useState(false);

  const toggleFilter = (key: keyof OrderFiltersState) => {
    setFilters({ ...filters, [key]: !filters[key], savedView: "all" as SavedView });
  };

  const updateFilter = (key: keyof OrderFiltersState, value: string) => {
    setFilters({ ...filters, [key]: value, savedView: "all" as SavedView });
  };

  return (
    <div className="space-y-2">
      {/* Saved view tabs */}
      <div className="flex flex-wrap gap-1.5">
        {savedViews.map(v => (
          <Badge
            key={v.key}
            variant={filters.savedView === v.key ? "default" : "outline"}
            className={`cursor-pointer px-3 py-1 text-xs hover:opacity-80 transition-opacity ${
              filters.savedView === v.key && v.color ? v.color : ""
            }`}
            onClick={() => applySavedView(v.key)}
          >
            {v.label}
          </Badge>
        ))}
      </div>

      {/* Search + toggles row */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search Order ID, SKU, Channel Ref..."
            className="pl-9 h-8"
            value={filters.search}
            onChange={e => updateFilter("search", e.target.value)}
          />
        </div>
        <Button variant="ghost" size="sm" className="h-8" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
          Filters
        </Button>
      </div>

      {/* Toggle chips */}
      <div className="flex flex-wrap gap-1">
        {toggleChips.map(chip => (
          <Badge
            key={chip.key}
            variant={filters[chip.key] ? "default" : "secondary"}
            className={`cursor-pointer px-2 py-0.5 text-xs transition-colors ${
              filters[chip.key]
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/80"
                : "hover:bg-accent"
            }`}
            onClick={() => toggleFilter(chip.key)}
          >
            {chip.label}
          </Badge>
        ))}
      </div>

      {/* Status quick-filter chips */}
      <div className="flex flex-wrap gap-1 items-center">
        <span className="text-xs text-muted-foreground mr-1">Status:</span>
        {statusChips.map(status => {
          const isActive = filters.orderStatus === status;
          const statusColors: Record<string, string> = {
            New: "bg-blue-500/15 text-blue-400 border-blue-500/30",
            "Awaiting Picking": "bg-amber-500/15 text-amber-400 border-amber-500/30",
            "On Back Order": "bg-purple-500/15 text-purple-400 border-purple-500/30",
            Despatched: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
            Cancelled: "bg-muted text-muted-foreground border-border",
          };
          return (
            <Badge
              key={status}
              variant="outline"
              className={`cursor-pointer px-2 py-0.5 text-xs transition-colors ${
                isActive ? statusColors[status] + " ring-1 ring-primary" : "hover:bg-accent"
              }`}
              onClick={() => updateFilter("orderStatus", isActive ? "" : status)}
            >
              {status}
            </Badge>
          );
        })}
      </div>

      {/* Expanded filters */}
      {expanded && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Select value={filters.brand || "all"} onValueChange={v => updateFilter("brand", v === "all" ? "" : v)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Brand" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Brands</SelectItem>
              {filterOptions.brands.map(b => <SelectItem key={b} value={b!}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.channel || "all"} onValueChange={v => updateFilter("channel", v === "all" ? "" : v)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              {filterOptions.channels.map(c => <SelectItem key={c} value={c!}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.severity || "all"} onValueChange={v => updateFilter("severity", v === "all" ? "" : v)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="watch">Watch</SelectItem>
              <SelectItem value="problem">Problem</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.problemType || "all"} onValueChange={v => updateFilter("problemType", v === "all" ? "" : v)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Problem Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="new_stuck">New Stuck</SelectItem>
              <SelectItem value="stalled_progress">Stalled Progress</SelectItem>
              <SelectItem value="repeated_snapshot">Repeated Snapshot</SelectItem>
              <SelectItem value="stock_discrepancy_suspected">Stock Discrepancy</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.issueStatus || "all"} onValueChange={v => updateFilter("issueStatus", v === "all" ? "" : v)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Issue Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_review">In Review</SelectItem>
              <SelectItem value="waiting_stock">Waiting Stock</SelectItem>
              <SelectItem value="waiting_supplier">Waiting Supplier</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="auto_resolved">Auto Resolved</SelectItem>
              <SelectItem value="ignored">Ignored</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.warehouse || "all"} onValueChange={v => updateFilter("warehouse", v === "all" ? "" : v)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Warehouse" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Warehouses</SelectItem>
              {filterOptions.warehouses.map(w => <SelectItem key={w} value={w!}>{w}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
