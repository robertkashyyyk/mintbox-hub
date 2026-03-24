import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FilterState } from "@/components/sku-database/SkuFilters";

export type SortField = 
  | "sku" 
  | "name" 
  | "current_stock" 
  | "back_order_qty" 
  | "on_order" 
  | "low_stock_alert_level" 
  | "cost_price" 
  | "last_stock_sync"
  | "brand";

export type SortDirection = "asc" | "desc";

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

const ITEMS_PER_PAGE = 100;

export const useSkuDatabase = () => {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ field: "sku", direction: "asc" });
  const [filters, setFilters] = useState<FilterState>(() => {
    const saved = localStorage.getItem("skuDatabaseFilters");
    return saved ? JSON.parse(saved) : {
      search: "",
      brand: "",
      status: "",
      categories: [],
      stockMin: 0,
      stockMax: 10000,
      backOrderMin: 0,
      backOrderMax: 10000,
      onOrderMin: 0,
      onOrderMax: 10000,
      qtyToOrderMin: 0,
      qtyToOrderMax: 10000,
      costPriceMin: 0,
      costPriceMax: 1000,
      lastSyncedFrom: "",
      lastSyncedTo: "",
    };
  });

  // Save filters to localStorage
  useEffect(() => {
    localStorage.setItem("skuDatabaseFilters", JSON.stringify(filters));
  }, [filters]);

  // Save sort to localStorage
  useEffect(() => {
    localStorage.setItem("skuDatabaseSort", JSON.stringify(sort));
  }, [sort]);

  // Restore sort from localStorage
  useEffect(() => {
    const savedSort = localStorage.getItem("skuDatabaseSort");
    if (savedSort) {
      setSort(JSON.parse(savedSort));
    }
  }, []);

  const { data: brands } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("*")
        .order("name");

      if (error) throw error;
      return data;
    },
  });

  const { data: productsData, isLoading } = useQuery({
    queryKey: ["products-cache-filtered", page, sort, filters],
    queryFn: async () => {
      let query = supabase
        .from("products_cache")
        .select(`
          id,
          sku,
          name,
          barcode,
          barcode_type_id,
          barcode_types (type_name),
          discontinued,
          suppliers,
          low_stock_alert_level,
          weight,
          height,
          length,
          depth,
          cost_price,
          handling_time,
          current_stock,
          back_order_qty,
          on_order,
          last_stock_sync,
          mintsoft_product_id,
          discovery_source,
          discovered_at,
          created_at,
          product_category_links (
            product_categories (name)
          ),
          product_images!product_images_product_id_fkey (
            public_url
          )
        `, { count: 'exact' });

      // Apply text search
      if (filters.search) {
        query = query.or(`sku.ilike.%${filters.search}%,name.ilike.%${filters.search}%,barcode.ilike.%${filters.search}%`);
      }

      // Apply status filter
      if (filters.status === "active") {
        query = query.eq("discontinued", false);
      } else if (filters.status === "discontinued") {
        query = query.eq("discontinued", true);
      }

      // Apply numeric filters
      if (filters.stockMin > 0 || filters.stockMax < 10000) {
        query = query.gte("current_stock", filters.stockMin).lte("current_stock", filters.stockMax);
      }

      if (filters.backOrderMin > 0 || filters.backOrderMax < 10000) {
        query = query.gte("back_order_qty", filters.backOrderMin).lte("back_order_qty", filters.backOrderMax);
      }

      if (filters.onOrderMin > 0 || filters.onOrderMax < 10000) {
        query = query.gte("on_order", filters.onOrderMin).lte("on_order", filters.onOrderMax);
      }

      if (filters.costPriceMin > 0 || filters.costPriceMax < 1000) {
        query = query.gte("cost_price", filters.costPriceMin).lte("cost_price", filters.costPriceMax);
      }

      // Apply date filters
      if (filters.lastSyncedFrom) {
        query = query.gte("last_stock_sync", filters.lastSyncedFrom);
      }
      if (filters.lastSyncedTo) {
        query = query.lte("last_stock_sync", filters.lastSyncedTo);
      }

      // Apply sorting
      if (sort.field !== "brand") {
        query = query.order(sort.field, { ascending: sort.direction === "asc" });
      }

      // Apply pagination
      const from = (page - 1) * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      // Client-side brand filtering and sorting if needed
      let filteredData = data || [];

      if (filters.brand && brands) {
        filteredData = filteredData.filter((product) => {
          const brandName = getBrandFromSku(product.sku, brands);
          return brandName === filters.brand;
        });
      }

      if (sort.field === "brand" && brands) {
        filteredData = [...filteredData].sort((a, b) => {
          const brandA = getBrandFromSku(a.sku, brands) || "";
          const brandB = getBrandFromSku(b.sku, brands) || "";
          return sort.direction === "asc" 
            ? brandA.localeCompare(brandB)
            : brandB.localeCompare(brandA);
        });
      }

      return { 
        products: filteredData, 
        totalCount: count || 0,
        filteredCount: filteredData.length 
      };
    },
    enabled: !!brands,
  });

  const getBrandFromSku = (sku: string, brandsList: any[]) => {
    for (const brand of brandsList) {
      const separator = brand.prefix_style === "slash" ? "/" : "-";
      const prefix = `${brand.prefix}${separator}`;
      
      if (sku.startsWith(prefix)) {
        return brand.name;
      }
    }
    return null;
  };

  const handleSortChange = (field: SortField) => {
    setSort((prev) => ({
      field,
      direction: prev.field === field && prev.direction === "asc" ? "desc" : "asc",
    }));
    setPage(1); // Reset to first page when sorting changes
  };

  const handleFiltersChange = (newFilters: FilterState) => {
    setFilters(newFilters);
    setPage(1); // Reset to first page when filters change
  };

  const totalPages = productsData ? Math.ceil(productsData.totalCount / ITEMS_PER_PAGE) : 0;

  return {
    products: productsData?.products || [],
    totalCount: productsData?.totalCount || 0,
    filteredCount: productsData?.filteredCount || 0,
    isLoading,
    page,
    setPage,
    totalPages,
    sort,
    handleSortChange,
    filters,
    handleFiltersChange,
    brands: brands || [],
    getBrandFromSku: (sku: string) => getBrandFromSku(sku, brands || []),
  };
};
