import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface BuyRecommendationRow {
  sku: string;
  brand_id: string;
  brand_name?: string;
  avg_weekly_units: number;
  on_hand_qty: number;
  base_multiplier: number;
  weeks_of_cover: number;
  target_stock: number;
  recommended_purchase_qty: number;
}

interface BuyRecommendationFilters {
  search: string;
  brandId: string;
  minRecommendedQty: string;
  onlyHighPriority: boolean;
}

export const useBuyRecommendations = () => {
  const [data, setData] = useState<BuyRecommendationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { toast } = useToast();

  const [filters, setFilters] = useState<BuyRecommendationFilters>(() => {
    const saved = localStorage.getItem("buyRecommendationFilters");
    return saved ? JSON.parse(saved) : {
      search: "",
      brandId: "all",
      minRecommendedQty: "",
      onlyHighPriority: false,
    };
  });

  const [sortBy, setSortBy] = useState<string>(() => {
    return localStorage.getItem("buyRecommendationSortBy") || "recommended_purchase_qty";
  });
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => {
    return (localStorage.getItem("buyRecommendationSortOrder") as "asc" | "desc") || "desc";
  });

  useEffect(() => {
    localStorage.setItem("buyRecommendationFilters", JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    localStorage.setItem("buyRecommendationSortBy", sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem("buyRecommendationSortOrder", sortOrder);
  }, [sortOrder]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Query sku_stock_health and compute buy recommendations
      let query = supabase
        .from("sku_stock_health")
        .select("sku, brand_id, avg_weekly_units, on_hand_qty, base_multiplier, weeks_of_cover, health_category", { count: "exact" })
        .in("health_category", ["Low Stock", "Critical", "Out of Stock"])
        .gt("avg_weekly_units", 0);

      // Apply filters
      if (filters.search) {
        query = query.ilike("sku", `%${filters.search}%`);
      }

      if (filters.brandId && filters.brandId !== "all") {
        query = query.eq("brand_id", filters.brandId);
      }

      if (filters.minRecommendedQty) {
        const minQty = parseFloat(filters.minRecommendedQty);
        if (!isNaN(minQty)) {
          query = query.gte("recommended_purchase_qty", minQty);
        }
      }

      if (filters.onlyHighPriority) {
        query = query.gte("recommended_purchase_qty", 10);
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
      const brandIds = [...new Set(healthData?.map(row => row.brand_id).filter(Boolean) as string[])];
      const { data: brandsData } = await supabase
        .from("brands")
        .select("id, name")
        .in("id", brandIds.length > 0 ? brandIds : ['00000000-0000-0000-0000-000000000000']);

      const brandMap = new Map(brandsData?.map(b => [b.id, b.name]));

      // Transform to buy recommendation rows with computed fields
      const enrichedData: BuyRecommendationRow[] = (healthData || []).map(row => {
        const avgWeekly = row.avg_weekly_units || 0;
        const multiplier = row.base_multiplier || 4;
        const onHand = row.on_hand_qty || 0;
        const targetStock = Math.ceil(avgWeekly * multiplier * 4);
        const recommendedQty = Math.max(0, targetStock - onHand);
        
        return {
          sku: row.sku,
          brand_id: row.brand_id || "",
          brand_name: row.brand_id ? brandMap.get(row.brand_id) || "Unknown" : "Unknown",
          avg_weekly_units: avgWeekly,
          on_hand_qty: onHand,
          base_multiplier: multiplier,
          weeks_of_cover: row.weeks_of_cover || 0,
          target_stock: targetStock,
          recommended_purchase_qty: recommendedQty,
        };
      });

      setData(enrichedData);
      setTotalCount(count || 0);
    } catch (error: any) {
      toast({
        title: "Error loading buy recommendations",
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

  const handleFiltersChange = (newFilters: Partial<BuyRecommendationFilters>) => {
    setFilters({ ...filters, ...newFilters });
    setPage(1);
  };

  const exportToCSV = () => {
    const headers = ["SKU", "Brand", "Avg_week", "Current_stock", "Target_stock", "Recommended_purchase_qty", "Weeks_of_cover"];
    const rows = data.map(row => [
      row.sku,
      row.brand_name || "Unknown",
      row.avg_weekly_units.toString(),
      row.on_hand_qty.toString(),
      row.target_stock.toString(),
      row.recommended_purchase_qty.toString(),
      row.weeks_of_cover.toFixed(2),
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `buy_recommendations_${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
    exportToCSV,
  };
};
