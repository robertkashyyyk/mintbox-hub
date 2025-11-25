import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

interface Brand {
  id: string;
  name: string;
}

interface BuyRecommendationFiltersProps {
  filters: {
    search: string;
    brandId: string;
    minRecommendedQty: string;
    onlyHighPriority: boolean;
  };
  onFiltersChange: (filters: any) => void;
}

export const BuyRecommendationFilters = ({ filters, onFiltersChange }: BuyRecommendationFiltersProps) => {
  const [brands, setBrands] = useState<Brand[]>([]);

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

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-card">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-2">
          <Label htmlFor="search">Search SKU</Label>
          <Input
            id="search"
            placeholder="Enter SKU..."
            value={filters.search}
            onChange={(e) => onFiltersChange({ search: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="brand">Brand</Label>
          <Select
            value={filters.brandId}
            onValueChange={(value) => onFiltersChange({ brandId: value })}
          >
            <SelectTrigger id="brand">
              <SelectValue placeholder="All brands" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All brands</SelectItem>
              {brands.map((brand) => (
                <SelectItem key={brand.id} value={brand.id}>
                  {brand.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="minQty">Min Recommended Qty</Label>
          <Input
            id="minQty"
            type="number"
            placeholder="e.g. 3"
            value={filters.minRecommendedQty}
            onChange={(e) => onFiltersChange({ minRecommendedQty: e.target.value })}
          />
        </div>

        <div className="space-y-2 flex items-end">
          <div className="flex items-center space-x-2">
            <Switch
              id="highPriority"
              checked={filters.onlyHighPriority}
              onCheckedChange={(checked) => onFiltersChange({ onlyHighPriority: checked })}
            />
            <Label htmlFor="highPriority" className="cursor-pointer">
              Only high priority (≥10)
            </Label>
          </div>
        </div>
      </div>
    </div>
  );
};
