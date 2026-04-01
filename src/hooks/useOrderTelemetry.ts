import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SavedView =
  | "needs_action"
  | "all"
  | "problems"
  | "critical"
  | "repeated"
  | "new_12h"
  | "new_24h"
  | "stock_issues";

export interface OrderFiltersState {
  search: string;
  brand: string;
  channel: string;
  warehouse: string;
  orderStatus: string;
  severity: string;
  problemType: string;
  issueStatus: string;
  assignedTo: string;
  problemOnly: boolean;
  openOnly: boolean;
  criticalOnly: boolean;
  repeatedOnly: boolean;
  newStuckOnly: boolean;
  unassignedOnly: boolean;
  stockIssueOnly: boolean;
  savedView: SavedView;
}

const defaultFilters: OrderFiltersState = {
  search: "",
  brand: "",
  channel: "",
  warehouse: "",
  orderStatus: "",
  severity: "",
  problemType: "",
  issueStatus: "",
  assignedTo: "",
  problemOnly: false,
  openOnly: false,
  criticalOnly: false,
  repeatedOnly: false,
  newStuckOnly: false,
  unassignedOnly: false,
  stockIssueOnly: false,
  savedView: "needs_action", // Default to Needs Action Now
};

export interface EnrichedOrderLine {
  id: number;
  mintsoft_order_id: number;
  line_index: number;
  sku: string;
  qty: number;
  order_date: string;
  channel: string | null;
  channel_order_ref: string | null;
  warehouse_id: string | null;
  brand_id: string | null;
  order_status: string | null;
  order_status_id: number | null;
  product_name: string | null;
  customer_name: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  times_seen: number | null;
  last_status_change_at: string | null;
  brands: { name: string } | null;
  age_hours: number;
  status_age_hours: number;
  sku_problem_count: number;
  issue?: {
    id: string;
    problem_type: string;
    severity: string;
    reason: string | null;
    issue_status: string;
    assigned_to: string | null;
    is_suppressed: boolean;
    suppression_reason: string | null;
    internal_notes: string | null;
    first_problem_seen_at: string | null;
    last_problem_seen_at: string | null;
    suggested_action: string | null;
  } | null;
}

export type SortKey = "order" | "age" | "status" | "sku" | "product" | "qty" | "problem" | "severity" | "reason" | "issue" | "assigned" | "brand" | "channel";
export type SortDir = "asc" | "desc";

export function useOrderTelemetry() {
  const [filters, setFilters] = useState<OrderFiltersState>(defaultFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: orderLines, isLoading: isLoadingOrders, refetch: refetchOrders } = useQuery({
    queryKey: ["order-lines-telemetry"],
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      let allData: any[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("order_lines")
          .select(`*, brands (name)`)
          .order("order_date", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        allData = allData.concat(data || []);
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return allData;
    },
  });

  const { data: orderIssues, isLoading: isLoadingIssues, refetch: refetchIssues } = useQuery({
    queryKey: ["order-issues"],
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      let allData: any[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("order_issues")
          .select("*")
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        allData = allData.concat(data || []);
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return allData;
    },
  });

  // Build SKU problem count map
  const skuProblemCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (!orderIssues) return map;
    for (const issue of orderIssues) {
      if (issue.issue_status === "open" || issue.issue_status === "in_review") {
        map[issue.sku] = (map[issue.sku] || 0) + 1;
      }
    }
    return map;
  }, [orderIssues]);

  const enrichedLines = useMemo((): EnrichedOrderLine[] => {
    if (!orderLines) return [];

    return orderLines.map((line: any) => {
      const ageHours = (Date.now() - new Date(line.order_date).getTime()) / (1000 * 60 * 60);
      const statusAgeHours = line.last_status_change_at
        ? (Date.now() - new Date(line.last_status_change_at).getTime()) / (1000 * 60 * 60)
        : ageHours;

      const lineIssues = (orderIssues || [])
        .filter(
          (i: any) =>
            i.mintsoft_order_id === line.mintsoft_order_id &&
            i.line_index === line.line_index
        )
        .sort((a: any, b: any) => {
          const rank: Record<string, number> = { critical: 3, problem: 2, watch: 1 };
          return (rank[b.severity] || 0) - (rank[a.severity] || 0);
        });

      const topIssue = lineIssues[0] || null;

      return {
        ...line,
        age_hours: Math.round(ageHours),
        status_age_hours: Math.round(statusAgeHours),
        sku_problem_count: skuProblemCountMap[line.sku] || 0,
        issue: topIssue
          ? {
              id: topIssue.id,
              problem_type: topIssue.problem_type,
              severity: topIssue.severity,
              reason: topIssue.reason,
              issue_status: topIssue.issue_status,
              assigned_to: topIssue.assigned_to,
              is_suppressed: topIssue.is_suppressed,
              suppression_reason: topIssue.suppression_reason,
              internal_notes: topIssue.internal_notes,
              first_problem_seen_at: topIssue.first_problem_seen_at,
              last_problem_seen_at: topIssue.last_problem_seen_at,
            }
          : null,
      };
    });
  }, [orderLines, orderIssues, skuProblemCountMap]);

  const applySavedView = (view: SavedView) => {
    const base = { ...defaultFilters, savedView: view };
    switch (view) {
      case "problems":
        base.problemOnly = true;
        break;
      case "critical":
        base.criticalOnly = true;
        break;
      case "needs_action":
        // Handled in filter logic below
        break;
      case "repeated":
        base.repeatedOnly = true;
        break;
      case "new_12h":
        base.newStuckOnly = true;
        break;
      case "new_24h":
        base.newStuckOnly = true;
        break;
      case "stock_issues":
        base.stockIssueOnly = true;
        break;
    }
    setFilters(base);
    setPage(1);
  };

  const filteredLines = useMemo(() => {
    let result = enrichedLines;

    // Needs Action Now — primary working view
    if (filters.savedView === "needs_action") {
      result = result.filter(
        l =>
          l.issue &&
          !l.issue.is_suppressed &&
          (l.issue.issue_status === "open" || l.issue.issue_status === "in_review") &&
          (l.issue.severity === "problem" || l.issue.severity === "critical")
      );
    }

    if (filters.search) {
      const s = filters.search.toLowerCase();
      result = result.filter(
        l =>
          l.mintsoft_order_id.toString().includes(s) ||
          l.sku.toLowerCase().includes(s) ||
          (l.channel_order_ref || "").toLowerCase().includes(s) ||
          (l.product_name || "").toLowerCase().includes(s)
      );
    }

    if (filters.brand) result = result.filter(l => l.brands?.name === filters.brand);
    if (filters.channel) result = result.filter(l => l.channel === filters.channel);
    if (filters.warehouse) result = result.filter(l => l.warehouse_id === filters.warehouse);
    if (filters.orderStatus) result = result.filter(l => l.order_status === filters.orderStatus);
    if (filters.severity) result = result.filter(l => l.issue?.severity === filters.severity);
    if (filters.problemType) result = result.filter(l => l.issue?.problem_type === filters.problemType);
    if (filters.issueStatus) result = result.filter(l => l.issue?.issue_status === filters.issueStatus);
    if (filters.assignedTo) result = result.filter(l => l.issue?.assigned_to === filters.assignedTo);

    if (filters.problemOnly) result = result.filter(l => l.issue && !["auto_resolved", "resolved"].includes(l.issue.issue_status));
    if (filters.openOnly) result = result.filter(l => l.issue?.issue_status === "open" || l.issue?.issue_status === "in_review");
    if (filters.criticalOnly) result = result.filter(l => l.issue?.severity === "critical");
    if (filters.repeatedOnly) result = result.filter(l => l.issue?.problem_type === "repeated_snapshot");
    if (filters.newStuckOnly) result = result.filter(l => l.issue?.problem_type === "new_stuck");
    if (filters.unassignedOnly) result = result.filter(l => l.issue && !l.issue.assigned_to && (l.issue.issue_status === "open" || l.issue.issue_status === "in_review"));
    if (filters.stockIssueOnly) result = result.filter(l => l.issue?.problem_type === "stock_discrepancy_suspected");

    if (filters.savedView === "new_24h") {
      result = result.filter(l => l.issue?.problem_type === "new_stuck" && l.age_hours >= 24);
    }

    // Sort
    const sevRank: Record<string, number> = { critical: 3, problem: 2, watch: 1 };
    const issueStatusRank: Record<string, number> = { open: 3, in_review: 2, waiting_stock: 1 };
    const dir = sortDir === "asc" ? 1 : -1;

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "order": cmp = a.mintsoft_order_id - b.mintsoft_order_id; break;
        case "age": cmp = a.age_hours - b.age_hours; break;
        case "status": cmp = (a.order_status || "").localeCompare(b.order_status || ""); break;
        case "sku": cmp = a.sku.localeCompare(b.sku); break;
        case "product": cmp = (a.product_name || "").localeCompare(b.product_name || ""); break;
        case "qty": cmp = a.qty - b.qty; break;
        case "problem": cmp = (a.issue?.problem_type || "").localeCompare(b.issue?.problem_type || ""); break;
        case "severity": {
          const aSev = a.issue ? (sevRank[a.issue.severity] || 0) : 0;
          const bSev = b.issue ? (sevRank[b.issue.severity] || 0) : 0;
          cmp = aSev - bSev;
          break;
        }
        case "reason": cmp = (a.issue?.reason || "").localeCompare(b.issue?.reason || ""); break;
        case "issue": {
          const aR = a.issue ? (issueStatusRank[a.issue.issue_status] || 0) : 0;
          const bR = b.issue ? (issueStatusRank[b.issue.issue_status] || 0) : 0;
          cmp = aR - bR;
          break;
        }
        case "assigned": cmp = (a.issue?.assigned_to || "").localeCompare(b.issue?.assigned_to || ""); break;
        case "brand": cmp = (a.brands?.name || "").localeCompare(b.brands?.name || ""); break;
        case "channel": cmp = (a.channel || "").localeCompare(b.channel || ""); break;
      }
      if (cmp !== 0) return cmp * dir;
      // Secondary sort: severity desc, then age desc
      const aSev = a.issue ? (sevRank[a.issue.severity] || 0) : 0;
      const bSev = b.issue ? (sevRank[b.issue.severity] || 0) : 0;
      if (bSev !== aSev) return bSev - aSev;
      return b.age_hours - a.age_hours;
    });

    return result;
  }, [enrichedLines, filters, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredLines.length / pageSize));
  const paginatedLines = filteredLines.slice((page - 1) * pageSize, page * pageSize);

  const filterOptions = useMemo(() => {
    const brands = [...new Set(enrichedLines.map(l => l.brands?.name).filter(Boolean))].sort();
    const channels = [...new Set(enrichedLines.map(l => l.channel).filter(Boolean))].sort();
    const warehouses = [...new Set(enrichedLines.map(l => l.warehouse_id).filter(Boolean))].sort();
    const statuses = [...new Set(enrichedLines.map(l => l.order_status).filter(Boolean))].sort();
    return { brands, channels, warehouses, statuses };
  }, [enrichedLines]);

  const stats = useMemo(() => {
    const totalOrders = new Set(enrichedLines.map(l => l.mintsoft_order_id)).size;
    const problemLines = enrichedLines.filter(
      l => l.issue && !["auto_resolved", "resolved"].includes(l.issue.issue_status)
    );
    const criticalLines = enrichedLines.filter(l => l.issue?.severity === "critical" && l.issue?.issue_status === "open");
    const openIssues = enrichedLines.filter(
      l => (l.issue?.issue_status === "open" || l.issue?.issue_status === "in_review") && !l.issue?.is_suppressed
    );
    const needsAction = enrichedLines.filter(
      l => l.issue && !l.issue.is_suppressed &&
        (l.issue.issue_status === "open" || l.issue.issue_status === "in_review") &&
        (l.issue.severity === "problem" || l.issue.severity === "critical")
    );
    return {
      totalLines: enrichedLines.length,
      totalOrders,
      problemCount: problemLines.length,
      criticalCount: criticalLines.length,
      openIssueCount: openIssues.length,
      needsActionCount: needsAction.length,
    };
  }, [enrichedLines]);

  const refetch = () => {
    refetchOrders();
    refetchIssues();
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  return {
    filters,
    setFilters,
    applySavedView,
    page,
    setPage,
    pageSize,
    setPageSize,
    paginatedLines,
    filteredLines,
    totalPages,
    stats,
    filterOptions,
    isLoading: isLoadingOrders || isLoadingIssues,
    refetch,
    sortKey,
    sortDir,
    toggleSort,
  };
}
