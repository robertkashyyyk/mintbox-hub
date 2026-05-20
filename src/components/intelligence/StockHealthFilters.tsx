import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface StockHealthFiltersState {
  search: string;
  brandId: string;
  healthCategory: string;
  onlyGoodProblems: boolean;
  onlyBadProblems: boolean;
  excludeDirt: boolean;
  excludeOutOfStock: boolean;
}

interface StockHealthFiltersProps {
  filters: StockHealthFiltersState;
  onFiltersChange: (filters: Partial<StockHealthFiltersState>) => void;
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
  "Non Selling",
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
    onFiltersChange({
      search: "",
      brandId: "all",
      healthCategory: "all",
      onlyGoodProblems: false,
      onlyBadProblems: false,
      excludeDirt: false,
      excludeOutOfStock: false,
    });
  };

  const activeFilterCount = [
    filters.search,
    filters.brandId !== "all" ? filters.brandId : "",
    filters.healthCategory !== "all" ? filters.healthCategory : "",
    filters.onlyGoodProblems,
    filters.onlyBadProblems,
    filters.excludeDirt,
    filters.excludeOutOfStock,
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
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3 pt-2">
        <div className="flex items-center space-x-2">
          <Switch
            id="only-good-problems"
            checked={filters.onlyGoodProblems}
            onCheckedChange={(checked) => onFiltersChange({ onlyGoodProblems: checked })}
          />
          <Label htmlFor="only-good-problems" className="text-sm font-medium cursor-pointer">
            Only "Good" problems
            <span className="text-xs text-muted-foreground ml-1">(Out of Stock, Critical, Low)</span>
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            id="only-bad-problems"
            checked={filters.onlyBadProblems}
            onCheckedChange={(checked) => onFiltersChange({ onlyBadProblems: checked })}
          />
          <Label htmlFor="only-bad-problems" className="text-sm font-medium cursor-pointer">
            Only "Bad" problems
            <span className="text-xs text-muted-foreground ml-1">(Extreme, Overstock, Unhealthy, Dead, Non Selling)</span>
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            id="exclude-oos"
            checked={filters.excludeOutOfStock}
            onCheckedChange={(checked) => onFiltersChange({ excludeOutOfStock: checked })}
          />
          <Label htmlFor="exclude-oos" className="text-sm font-medium cursor-pointer">
            Exclude O/S
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <Switch
            id="exclude-dirt"
            checked={filters.excludeDirt}
            onCheckedChange={(checked) => onFiltersChange({ excludeDirt: checked })}
          />
          <Label htmlFor="exclude-dirt" className="text-sm font-medium cursor-pointer">
            Exclude DIRT
          </Label>
        </div>
      </div>
    </div>
  );
};
