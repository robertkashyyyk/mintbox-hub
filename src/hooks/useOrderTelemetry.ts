import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TelemetryView = "all_open" | "unordered" | "bouncers" | "backorders";

export interface TelemetryFilters {
  search: string;
  brand: string;
  channel: string;
  view: TelemetryView;
}

const defaultFilters: TelemetryFilters = {
  search: "",
  brand: "",
  channel: "",
  view: "all_open",
};

export interface OpenOrderLine {
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
  last_status_change_at: string | null;
  last_backordered_at: string | null;
  brand_name: string | null;
  bounce_back_count: number;
  current_stock: number;
  on_order_qty: number;
  on_active_po: boolean;
  days_on_backorder: number | null;
  problem_kind: "unordered" | "bouncer" | "chronic_backorder" | null;
  age_hours: number;
}

export type SortKey = "order" | "age" | "status" | "sku" | "product" | "qty" | "bouncer" | "backorder_days" | "brand" | "channel";
export type SortDir = "asc" | "desc";

export function useOrderTelemetry() {
  const [filters, setFilters] = useState<TelemetryFilters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sortKey, setSortKey] = useState<SortKey>("age");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: rows, isLoading, error, refetch } = useQuery({
    queryKey: ["order-telemetry-open"],
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      const PAGE = 1000;
      let all: any[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("order_telemetry_open_lines" as any)
          .select("*")
          .order("order_date", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) {
          console.error("[useOrderTelemetry] fetch failed at offset", from, error);
          throw error;
        }
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
  });

  const { data: lastSyncAt } = useQuery({
    queryKey: ["order-telemetry-last-sync"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("edge_function_runs")
        .select("started_at")
        .eq("function_name", "sync-mintsoft-orders")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data?.started_at ?? null;
    },
  });

  const enriched = useMemo((): OpenOrderLine[] => {
    if (!rows) return [];
    return rows.map((r: any) => ({
      ...r,
      age_hours: Math.round((Date.now() - new Date(r.order_date).getTime()) / 3600000),
    }));
  }, [rows]);

  const setView = (view: TelemetryView) => {
    setFilters(f => ({ ...f, view }));
    setPage(1);
  };

  const filtered = useMemo(() => {
    let result = enriched;
    if (filters.view === "unordered") result = result.filter(l => l.problem_kind === "unordered");
    else if (filters.view === "bouncers") result = result.filter(l => l.problem_kind === "bouncer");
    else if (filters.view === "backorders") result = result.filter(l => l.order_status === "ONBACKORDER");

    if (filters.search) {
      const s = filters.search.toLowerCase();
      result = result.filter(
        l =>
          l.mintsoft_order_id.toString().includes(s) ||
          l.sku.toLowerCase().includes(s) ||
          (l.channel_order_ref || "").toLowerCase().includes(s) ||
          (l.product_name || "").toLowerCase().includes(s),
      );
    }
    if (filters.brand) result = result.filter(l => l.brand_name === filters.brand);
    if (filters.channel) result = result.filter(l => l.channel === filters.channel);

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
        case "bouncer": cmp = a.bounce_back_count - b.bounce_back_count; break;
        case "backorder_days": cmp = (a.days_on_backorder ?? -1) - (b.days_on_backorder ?? -1); break;
        case "brand": cmp = (a.brand_name || "").localeCompare(b.brand_name || ""); break;
        case "channel": cmp = (a.channel || "").localeCompare(b.channel || ""); break;
      }
      return cmp * dir;
    });
    return result;
  }, [enriched, filters, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const filterOptions = useMemo(() => {
    const brands = [...new Set(enriched.map(l => l.brand_name).filter(Boolean) as string[])].sort();
    const channels = [...new Set(enriched.map(l => l.channel).filter(Boolean) as string[])].sort();
    return { brands, channels };
  }, [enriched]);

  const stats = useMemo(() => {
    const totalOpenOrders = new Set(enriched.map(l => l.mintsoft_order_id)).size;
    const unorderedOrders = new Set(
      enriched.filter(l => l.problem_kind === "unordered").map(l => l.mintsoft_order_id),
    ).size;
    const bouncerOrders = new Set(
      enriched.filter(l => l.problem_kind === "bouncer").map(l => l.mintsoft_order_id),
    ).size;
    const chronicLines = enriched.filter(l => l.problem_kind === "chronic_backorder").length;
    return { totalOpenOrders, unorderedOrders, bouncerOrders, chronicLines };
  }, [enriched]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
    setPage(1);
  };

  return {
    filters, setFilters, setView,
    page, setPage, pageSize, setPageSize,
    paginated, filtered, totalPages,
    stats, filterOptions,
    isLoading, error: (error as Error | null) || null,
    refetch,
    sortKey, sortDir, toggleSort,
    lastSyncAt: lastSyncAt as string | null | undefined,
  };
}

// Backwards-compat alias for any older imports
export type EnrichedOrderLine = OpenOrderLine;
