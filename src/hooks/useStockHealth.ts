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
  quarantined: boolean;
  units_4w?: number;
}

export interface StockHealthSummary {
  totalSkus: number;
  dirtSkus: number;
  byCategory: Record<string, number>;
  totalOnHand: number;
}

const GOOD_PROBLEM_CATEGORIES = ["Out of Stock", "Critical", "Low Stock"];
const BAD_PROBLEM_CATEGORIES = ["Extreme Overstock", "Overstock", "Unhealthy", "Dead Stock", "Non Selling"];

interface StockHealthFilters {
  search: string;
  brandId: string;
  healthCategory: string;
  onlyGoodProblems: boolean;
  onlyBadProblems: boolean;
  excludeDirt: boolean;
  excludeOutOfStock: boolean;
}

export const useStockHealth = () => {
  const [data, setData] = useState<StockHealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState<StockHealthSummary | null>(null);
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
      onlyGoodProblems: parsed.onlyGoodProblems ?? false,
      onlyBadProblems: parsed.onlyBadProblems ?? parsed.onlyProblems ?? false,
      excludeDirt: parsed.excludeDirt ?? false,
      excludeOutOfStock: parsed.excludeOutOfStock ?? false,
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

  const fetchData = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from("sku_stock_health")
        .select("*", { count: "exact" });

      // Dirt filter — server-side via the quarantined column in the MV.
      // Previously used a client-side NOT IN list which broke at scale (~40k items).
      if (filters.excludeDirt) {
        query = query.eq("quarantined", false);
      }

      if (filters.search) {
        query = query.ilike("sku", `%${filters.search}%`);
      }

      if (filters.brandId && filters.brandId !== "all") {
        query = query.eq("brand_id", filters.brandId);
      }

      if (filters.healthCategory && filters.healthCategory !== "all") {
        query = query.eq("health_category", filters.healthCategory);
      } else if (filters.onlyGoodProblems && filters.onlyBadProblems) {
        query = query.in("health_category", [...GOOD_PROBLEM_CATEGORIES, ...BAD_PROBLEM_CATEGORIES]);
      } else if (filters.onlyGoodProblems) {
        query = query.in("health_category", GOOD_PROBLEM_CATEGORIES);
      } else if (filters.onlyBadProblems) {
        query = query.in("health_category", BAD_PROBLEM_CATEGORIES);
      }

      if (filters.excludeOutOfStock) {
        // Exclude all zero-stock categories: "Out of Stock" (has velocity, no stock)
        // AND "Non Selling" (no velocity, no stock) — both have on_hand_qty = 0.
        query = query
          .neq("health_category", "Out of Stock")
          .neq("health_category", "Non Selling");
      }

      query = query.order(sortBy, { ascending: sortOrder === "asc" });

      const from = (page - 1) * pageSize;
      query = query.range(from, from + pageSize - 1);

      const { data: healthData, error, count } = await query;
      if (error) throw error;

      // Fetch brand names and velocity for the current page
      const brandIds = [...new Set(healthData?.map(row => row.brand_id).filter(Boolean))];
      const skus = (healthData ?? []).map((r: any) => r.sku).filter(Boolean);

      const [{ data: brandsData }, { data: velocityData }] = await Promise.all([
        supabase.from("brands").select("id, name").in("id", brandIds),
        skus.length > 0
          ? supabase.from("sku_velocity").select("sku, units_30d").in("sku", skus)
          : Promise.resolve({ data: [] as Array<{ sku: string; units_30d: number }> }),
      ]);

      const brandMap = new Map(brandsData?.map(b => [b.id, b.name]));
      const velocityMap = new Map((velocityData ?? []).map((v: any) => [v.sku, Number(v.units_30d ?? 0)]));

      const enrichedData = healthData?.map(row => ({
        ...row,
        brand_name: row.brand_id ? brandMap.get(row.brand_id) : "Unknown",
        units_4w: velocityMap.get(row.sku) ?? 0,
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

  const fetchSummary = async () => {
    try {
      const { data, error } = await supabase.rpc("get_stock_health_summary" as any, {
        p_brand_id: filters.brandId && filters.brandId !== "all" ? filters.brandId : null,
        p_exclude_dirt: filters.excludeDirt,
      });
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      if (!row) { setSummary(null); return; }
      setSummary({
        totalSkus: Number(row.total_skus ?? 0),
        dirtSkus: Number(row.dirt_skus ?? 0),
        byCategory: (row.by_category ?? {}) as Record<string, number>,
        totalOnHand: Number(row.total_on_hand ?? 0),
      });
    } catch {
      setSummary(null);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filters, sortBy, sortOrder, page]);

  useEffect(() => {
    fetchSummary();
  }, [filters.brandId, filters.excludeDirt]);

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
    // Dirt count now comes from the summary RPC (quarantined flag in MV),
    // not from a separately-loaded client-side list.
    dirtSkusCount: summary?.dirtSkus ?? 0,
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
