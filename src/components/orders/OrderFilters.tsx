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

const savedViews: { key: SavedView; label: string }[] = [
  { key: "all", label: "All Orders" },
  { key: "problems", label: "Problem Orders" },
  { key: "critical", label: "Critical" },
  { key: "needs_action", label: "Needs Action Now" },
  { key: "repeated", label: "Repeated Snapshots" },
  { key: "new_12h", label: "New > 12h" },
  { key: "new_24h", label: "New > 24h" },
  { key: "stock_issues", label: "Stock Issues" },
];

const toggleChips: { key: keyof OrderFiltersState; label: string }[] = [
  { key: "problemOnly", label: "Problem Orders Only" },
  { key: "openOnly", label: "Open Issues Only" },
  { key: "criticalOnly", label: "Critical Only" },
  { key: "repeatedOnly", label: "Repeated Orders" },
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
    <div className="space-y-3">
      {/* Saved view tabs */}
      <div className="flex flex-wrap gap-1.5">
        {savedViews.map((v) => (
          <Badge
            key={v.key}
            variant={filters.savedView === v.key ? "default" : "outline"}
            className="cursor-pointer px-3 py-1 text-xs hover:bg-primary/80"
            onClick={() => applySavedView(v.key)}
          >
            {v.label}
          </Badge>
        ))}
      </div>

      {/* Toggle chips */}
      <div className="flex flex-wrap gap-1.5">
        {toggleChips.map((chip) => (
          <Badge
            key={chip.key}
            variant={filters[chip.key] ? "default" : "secondary"}
            className={`cursor-pointer px-3 py-1 text-xs transition-colors ${
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

      {/* Search + expand */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search Order ID, SKU, Channel Ref..."
            className="pl-9"
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
          Filters
        </Button>
      </div>

      {/* Expanded filters */}
      {expanded && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Select value={filters.brand || "all"} onValueChange={(v) => updateFilter("brand", v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Brand" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Brands</SelectItem>
              {filterOptions.brands.map((b) => (
                <SelectItem key={b} value={b!}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.channel || "all"} onValueChange={(v) => updateFilter("channel", v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              {filterOptions.channels.map((c) => (
                <SelectItem key={c} value={c!}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.orderStatus || "all"} onValueChange={(v) => updateFilter("orderStatus", v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Order Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {filterOptions.statuses.map((s) => (
                <SelectItem key={s} value={s!}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.severity || "all"} onValueChange={(v) => updateFilter("severity", v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="watch">Watch</SelectItem>
              <SelectItem value="problem">Problem</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.problemType || "all"} onValueChange={(v) => updateFilter("problemType", v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Problem Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="new_stuck">New Stuck</SelectItem>
              <SelectItem value="stalled_progress">Stalled Progress</SelectItem>
              <SelectItem value="repeated_snapshot">Repeated Snapshot</SelectItem>
              <SelectItem value="stock_discrepancy_suspected">Stock Discrepancy</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.issueStatus || "all"} onValueChange={(v) => updateFilter("issueStatus", v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Issue Status" /></SelectTrigger>
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

          <Select value={filters.warehouse || "all"} onValueChange={(v) => updateFilter("warehouse", v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Warehouse" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Warehouses</SelectItem>
              {filterOptions.warehouses.map((w) => (
                <SelectItem key={w} value={w!}>{w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
