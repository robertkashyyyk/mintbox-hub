import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";

type SortField = "sku" | "units_30d" | "units_60d" | "units_90d" | "avg_weekly_units";
type SortDirection = "asc" | "desc";

interface SortState {
  field: SortField;
  direction: SortDirection;
}

interface Filters {
  search: string;
  brandId: string;
  minAvgWeekly: string;
}

export const useSkuVelocity = () => {
  const [page, setPage] = useState(1);
  const pageSize = 50;
  
  const [sort, setSort] = useState<SortState>(() => {
    const saved = localStorage.getItem("velocity_sort");
    return saved ? JSON.parse(saved) : { field: "avg_weekly_units", direction: "desc" };
  });

  const [filters, setFilters] = useState<Filters>(() => {
    const saved = localStorage.getItem("velocity_filters");
    return saved ? JSON.parse(saved) : { search: "", brandId: "all", minAvgWeekly: "" };
  });

  useEffect(() => {
    localStorage.setItem("velocity_sort", JSON.stringify(sort));
  }, [sort]);

  useEffect(() => {
    localStorage.setItem("velocity_filters", JSON.stringify(filters));
  }, [filters]);

  const { data: brandsData } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: velocityData, isLoading } = useQuery({
    queryKey: ["sku-velocity", page, sort, filters],
    queryFn: async () => {
      let query = supabase
        .from("sku_velocity")
        .select("*", { count: "exact" });

      // Apply filters
      if (filters.search) {
        query = query.ilike("sku", `%${filters.search}%`);
      }

      if (filters.brandId && filters.brandId !== "all") {
        query = query.eq("brand_id", filters.brandId);
      }

      if (filters.minAvgWeekly) {
        const minVal = parseFloat(filters.minAvgWeekly);
        if (!isNaN(minVal)) {
          query = query.gte("avg_weekly_units", minVal);
        }
      }

      // Apply sorting
      query = query.order(sort.field, { ascending: sort.direction === "asc" });

      // Apply pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      return {
        items: data || [],
        totalCount: count || 0,
        filteredCount: count || 0,
      };
    },
  });

  const handleSortChange = (field: SortField) => {
    setSort((prev) => ({
      field,
      direction: prev.field === field && prev.direction === "asc" ? "desc" : "asc",
    }));
    setPage(1);
  };

  const handleFiltersChange = (newFilters: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    setPage(1);
  };

  const getBrandName = (brandId: string | null) => {
    if (!brandId || !brandsData) return "Unknown";
    const brand = brandsData.find((b) => b.id === brandId);
    return brand ? brand.name : "Unknown";
  };

  return {
    items: velocityData?.items || [],
    totalCount: velocityData?.totalCount || 0,
    filteredCount: velocityData?.filteredCount || 0,
    isLoading,
    page,
    setPage,
    pageSize,
    sort,
    handleSortChange,
    filters,
    handleFiltersChange,
    brands: brandsData || [],
    getBrandName,
  };
};
