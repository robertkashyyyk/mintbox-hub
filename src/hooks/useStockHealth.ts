import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface StockHealthRow {
  sku: string;
  brand_id: string;
  brand_name?: string;
  avg_weekly_units: number;
  on_hand_qty: number;
  weeks_of_cover: number;
  base_multiplier: number;
  health_category: string;
}

export interface StockHealthSummary {
  totalSkus: number;
  dirtSkus: number;
  byCategory: Record<string, number>;
  totalOnHand: number;
}

interface StockHealthFilters {
  search: string;
  brandId: string;
  healthCategory: string;
  onlyProblems: boolean;
  excludeDirt: boolean;
}

export const useStockHealth = () => {
  const [data, setData] = useState<StockHealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState<StockHealthSummary | null>(null);
  const [dirtSkus, setDirtSkus] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { toast } = useToast();

  const [filters, setFilters] = useState<StockHealthFilters>(() => {
    const saved = localStorage.getItem("stockHealthFilters");
    const parsed = saved ? JSON.parse(saved) : {};
    return {
      search: parsed.search ?? "",
      brandId: parsed.brandId ?? "all",
      healthCategory: parsed.healthCategory ?? "all",
      onlyProblems: parsed.onlyProblems ?? false,
      excludeDirt: parsed.excludeDirt ?? false,
    };
  });

  const [sortBy, setSortBy] = useState<string>(() => {
    return localStorage.getItem("stockHealthSortBy") || "sku";
  });
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => {
    return (localStorage.getItem("stockHealthSortOrder") as "asc" | "desc") || "asc";
  });

  useEffect(() => {
    localStorage.setItem("stockHealthFilters", JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    localStorage.setItem("stockHealthSortBy", sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem("stockHealthSortOrder", sortOrder);
  }, [sortOrder]);

  // Load the dirt (quarantined) SKU list once — small set (~hundreds).
  useEffect(() => {
    (async () => {
      const { data: dirt } = await supabase
        .from("products_cache")
        .select("sku")
        .eq("quarantined", true);
      setDirtSkus((dirt ?? []).map((r: any) => r.sku).filter(Boolean));
    })();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from("sku_stock_health")
        .select("*", { count: "exact" });

      // Apply filters
      if (filters.search) {
        query = query.ilike("sku", `%${filters.search}%`);
      }

      if (filters.brandId && filters.brandId !== "all") {
        query = query.eq("brand_id", filters.brandId);
      }

      if (filters.healthCategory && filters.healthCategory !== "all") {
        query = query.eq("health_category", filters.healthCategory);
      }

      if (filters.onlyProblems) {
        query = query.neq("health_category", "Healthy");
      }

      if (filters.excludeDirt && dirtSkus.length > 0) {
        // PostgREST `not.in` with parenthesised list
        const list = `(${dirtSkus.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",")})`;
        query = query.not("sku", "in", list);
      }

      // Apply sorting
      query = query.order(sortBy, { ascending: sortOrder === "asc" });

      // Apply pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data: healthData, error, count } = await query;

      if (error) throw error;

      // Fetch brand names
      const brandIds = [...new Set(healthData?.map(row => row.brand_id).filter(Boolean))];
      const { data: brandsData } = await supabase
        .from("brands")
        .select("id, name")
        .in("id", brandIds);

      const brandMap = new Map(brandsData?.map(b => [b.id, b.name]));

      const enrichedData = healthData?.map(row => ({
        ...row,
        brand_name: row.brand_id ? brandMap.get(row.brand_id) : "Unknown",
      })) || [];

      setData(enrichedData);
      setTotalCount(count || 0);
    } catch (error: any) {
      toast({
        title: "Error loading stock health",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch top-level summary via server-side RPC (no row-cap; aggregates the full
  // 180k+ SKU view). Respects brand + excludeDirt; ignores text + category filters
  // so the tiles remain a stable overview the user can drill into.
  const fetchSummary = async () => {
    try {
      const { data, error } = await supabase.rpc("get_stock_health_summary" as any, {
        p_brand_id: filters.brandId && filters.brandId !== "all" ? filters.brandId : null,
        p_exclude_dirt: filters.excludeDirt,
      });
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      if (!row) {
        setSummary(null);
        return;
      }
      setSummary({
        totalSkus: Number(row.total_skus ?? 0),
        dirtSkus: Number(row.dirt_skus ?? 0),
        byCategory: (row.by_category ?? {}) as Record<string, number>,
        totalOnHand: Number(row.total_on_hand ?? 0),
      });
    } catch (e) {
      // Soft fail — summary is non-critical.
      setSummary(null);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filters, sortBy, sortOrder, page, dirtSkus]);

  useEffect(() => {
    fetchSummary();
  }, [filters.brandId, filters.excludeDirt, dirtSkus]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
  };

  const handleFiltersChange = (newFilters: Partial<StockHealthFilters>) => {
    setFilters({ ...filters, ...newFilters });
    setPage(1);
  };

  return {
    data,
    loading,
    totalCount,
    summary,
    dirtSkusCount: dirtSkus.length,
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
