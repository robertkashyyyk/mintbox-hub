import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface StockValuationRow {
  sku: string;
  brand_id: string | null;
  brand_name: string | null;
  current_stock: number;
  cost_price: number | null;
  net_value: number;
  health_category: string;
}

export interface CategoryAgg {
  skus: number;
  units: number;
  value: number;
}

export interface StockValuationSummary {
  totalSkus: number;
  totalUnits: number;
  totalValue: number;
  missingCostSkus: number;
  missingCostUnits: number;
  remoteSkus: number;
  remoteUnits: number;
  remoteValue: number;
  byCategory: Record<string, CategoryAgg>;
}

export interface StockValuationFilters {
  search: string;
  brandId: string;
  healthCategory: string;
  onlyMissingCost: boolean;
  onlyInStock: boolean;
  excludeDirt: boolean;
  excludeRemote: boolean;
}

const DEFAULT_FILTERS: StockValuationFilters = {
  search: "",
  brandId: "all",
  healthCategory: "all",
  onlyMissingCost: false,
  onlyInStock: true,
  excludeDirt: false,
  excludeRemote: true,
};

export const useStockValuation = () => {
  const { toast } = useToast();
  const [data, setData] = useState<StockValuationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState<StockValuationSummary | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [filters, setFilters] = useState<StockValuationFilters>(() => {
    const saved = localStorage.getItem("stockValuationFilters");
    return saved ? { ...DEFAULT_FILTERS, ...JSON.parse(saved) } : DEFAULT_FILTERS;
  });
  const [sortBy, setSortBy] = useState<string>(
    () => localStorage.getItem("stockValuationSortBy") || "net_value"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(
    () => (localStorage.getItem("stockValuationSortOrder") as "asc" | "desc") || "desc"
  );

  useEffect(() => {
    localStorage.setItem("stockValuationFilters", JSON.stringify(filters));
  }, [filters]);
  useEffect(() => {
    localStorage.setItem("stockValuationSortBy", sortBy);
    localStorage.setItem("stockValuationSortOrder", sortOrder);
  }, [sortBy, sortOrder]);

  const fetchRows = async () => {
    setLoading(true);
    try {
      let q = supabase.from("stock_valuation" as any).select("*", { count: "exact" });

      if (filters.search) q = q.ilike("sku", `%${filters.search}%`);
      if (filters.brandId !== "all") q = q.eq("brand_id", filters.brandId);
      if (filters.healthCategory !== "all")
        q = q.eq("health_category", filters.healthCategory);
      if (filters.onlyMissingCost) q = q.or("cost_price.is.null,cost_price.eq.0");
      if (filters.onlyInStock) q = q.gt("current_stock", 0);
      if (filters.excludeDirt) q = q.eq("quarantined", false);
      if (filters.excludeRemote) q = q.eq("is_remote", false);

      q = q.order(sortBy, { ascending: sortOrder === "asc", nullsFirst: false });

      const from = (page - 1) * pageSize;
      q = q.range(from, from + pageSize - 1);

      const { data: rows, error, count } = await q;
      if (error) throw error;
      setData((rows ?? []) as unknown as StockValuationRow[]);
      setTotalCount(count ?? 0);
    } catch (e: any) {
      toast({ title: "Error loading stock valuation", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const { data, error } = await supabase.rpc("get_stock_valuation_summary" as any, {
        p_brand_id: filters.brandId !== "all" ? filters.brandId : null,
        p_exclude_dirt: filters.excludeDirt,
        p_exclude_remote: filters.excludeRemote,
      });
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      if (!row) return setSummary(null);
      setSummary({
        totalSkus: Number(row.total_skus ?? 0),
        totalUnits: Number(row.total_units ?? 0),
        totalValue: Number(row.total_value ?? 0),
        missingCostSkus: Number(row.missing_cost_skus ?? 0),
        missingCostUnits: Number(row.missing_cost_units ?? 0),
        remoteSkus: Number(row.remote_skus ?? 0),
        remoteUnits: Number(row.remote_units ?? 0),
        remoteValue: Number(row.remote_value ?? 0),
        byCategory: (row.by_category ?? {}) as Record<string, CategoryAgg>,
      });
    } catch {
      setSummary(null);
    }
  };

  useEffect(() => {
    fetchRows();
  }, [filters, sortBy, sortOrder, page]);
  useEffect(() => {
    fetchSummary();
  }, [filters.brandId, filters.excludeDirt, filters.excludeRemote]);

  const handleFiltersChange = (next: Partial<StockValuationFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPage(1);
  };

  const handleSort = (col: string) => {
    if (sortBy === col) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else {
      setSortBy(col);
      setSortOrder("desc");
    }
  };

  return {
    data,
    loading,
    totalCount,
    summary,
    page,
    pageSize,
    setPage,
    filters,
    handleFiltersChange,
    sortBy,
    sortOrder,
    handleSort,
  };
};
