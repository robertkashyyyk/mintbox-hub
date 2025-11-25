import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface StockHealthFiltersProps {
  filters: {
    search: string;
    brandId: string;
    healthCategory: string;
    onlyProblems: boolean;
  };
  onFiltersChange: (filters: Partial<{
    search: string;
    brandId: string;
    healthCategory: string;
    onlyProblems: boolean;
  }>) => void;
}

const HEALTH_CATEGORIES = [
  "Extreme Overstock",
  "Overstock",
  "Unhealthy",
  "Healthy",
  "Low Stock",
  "Critical",
  "Dead Stock",
  "Out of Stock",
  "Missing Baseline",
  "Unknown",
];

export const StockHealthFilters = ({ filters, onFiltersChange }: StockHealthFiltersProps) => {
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const fetchBrands = async () => {
      const { data } = await supabase
        .from("brands")
        .select("id, name")
        .order("name");
      if (data) setBrands(data);
    };
    fetchBrands();
  }, []);

  const clearAllFilters = () => {
    onFiltersChange({ search: "", brandId: "all", healthCategory: "all", onlyProblems: false });
  };

  const activeFilterCount = [
    filters.search,
    filters.brandId,
    filters.healthCategory,
    filters.onlyProblems,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Filters</h3>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear all ({activeFilterCount})
          </Button>
        )}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="text-sm font-medium mb-2 block">Search SKU</label>
          <Input
            placeholder="Enter SKU..."
            value={filters.search}
            onChange={(e) => onFiltersChange({ search: e.target.value })}
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">Brand</label>
          <Select
            value={filters.brandId}
            onValueChange={(value) => onFiltersChange({ brandId: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Brands" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Brands</SelectItem>
              {brands.map((brand) => (
                <SelectItem key={brand.id} value={brand.id}>
                  {brand.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">Health Category</label>
          <Select
            value={filters.healthCategory}
            onValueChange={(value) => onFiltersChange({ healthCategory: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {HEALTH_CATEGORIES.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center space-x-2 pt-7">
          <Switch
            id="only-problems"
            checked={filters.onlyProblems}
            onCheckedChange={(checked) => onFiltersChange({ onlyProblems: checked })}
          />
          <Label htmlFor="only-problems" className="text-sm font-medium cursor-pointer">
            Only problems
          </Label>
        </div>
      </div>
    </div>
  );
};
