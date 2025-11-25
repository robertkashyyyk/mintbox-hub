import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface VelocityFiltersProps {
  filters: {
    search: string;
    brandId: string;
    minAvgWeekly: string;
  };
  onFiltersChange: (filters: Partial<{
    search: string;
    brandId: string;
    minAvgWeekly: string;
  }>) => void;
  brands: Array<{ id: string; name: string }>;
}

export const VelocityFilters = ({ filters, onFiltersChange, brands }: VelocityFiltersProps) => {
  const clearAllFilters = () => {
    onFiltersChange({ search: "", brandId: "", minAvgWeekly: "" });
  };

  const activeFilterCount = [
    filters.search,
    filters.brandId,
    filters.minAvgWeekly,
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
              <SelectItem value="">All Brands</SelectItem>
              {brands.map((brand) => (
                <SelectItem key={brand.id} value={brand.id}>
                  {brand.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-sm font-medium mb-2 block">Min Avg/Week</label>
          <Input
            type="number"
            placeholder="Min units per week"
            value={filters.minAvgWeekly}
            onChange={(e) => onFiltersChange({ minAvgWeekly: e.target.value })}
            min="0"
            step="0.1"
          />
        </div>
      </div>
    </div>
  );
};
