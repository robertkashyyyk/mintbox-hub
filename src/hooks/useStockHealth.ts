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

interface StockHealthFilters {
  search: string;
  brandId: string;
  healthCategory: string;
  onlyProblems: boolean;
}

export const useStockHealth = () => {
  const [data, setData] = useState<StockHealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { toast } = useToast();

  const [filters, setFilters] = useState<StockHealthFilters>(() => {
    const saved = localStorage.getItem("stockHealthFilters");
    return saved ? JSON.parse(saved) : {
      search: "",
      brandId: "",
      healthCategory: "",
      onlyProblems: false,
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

      // Apply filters
      if (filters.search) {
        query = query.ilike("sku", `%${filters.search}%`);
      }

      if (filters.brandId) {
        query = query.eq("brand_id", filters.brandId);
      }

      if (filters.healthCategory) {
        query = query.eq("health_category", filters.healthCategory);
      }

      if (filters.onlyProblems) {
        query = query.neq("health_category", "Healthy");
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

  useEffect(() => {
    fetchData();
  }, [filters, sortBy, sortOrder, page]);

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
