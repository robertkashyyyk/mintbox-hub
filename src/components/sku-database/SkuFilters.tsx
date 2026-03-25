import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Filter } from "lucide-react";

export interface FilterState {
  search: string;
  brand: string;
  status: string;
  categories: string[];
  stockMin: number;
  stockMax: number;
  backOrderMin: number;
  backOrderMax: number;
  onOrderMin: number;
  onOrderMax: number;
  qtyToOrderMin: number;
  qtyToOrderMax: number;
  costPriceMin: number;
  costPriceMax: number;
  lastSyncedFrom: string;
  lastSyncedTo: string;
  hasImages: boolean;
}

interface SkuFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  brands: Array<{ id: string; name: string }>;
  categories: string[];
}

const inputClasses = "text-white placeholder:text-white/40";

export const SkuFilters = ({
  filters,
  onFiltersChange,
  brands,
  categories,
}: SkuFiltersProps) => {
  const updateFilter = (key: keyof FilterState, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearAllFilters = () => {
    onFiltersChange({
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
      hasImages: false,
    });
  };

  const activeFilterCount = [
    filters.search,
    filters.brand,
    filters.status,
    filters.categories.length > 0,
    filters.stockMin > 0 || filters.stockMax < 10000,
    filters.backOrderMin > 0 || filters.backOrderMax < 10000,
    filters.onOrderMin > 0 || filters.onOrderMax < 10000,
    filters.qtyToOrderMin > 0 || filters.qtyToOrderMax < 10000,
    filters.costPriceMin > 0 || filters.costPriceMax < 1000,
    filters.lastSyncedFrom,
    filters.lastSyncedTo,
    filters.hasImages,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4 p-4 bg-card rounded-lg border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-pd-accent" />
          <h3 className="text-sm font-medium text-white">Filters</h3>
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {activeFilterCount} active
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAllFilters}
          disabled={activeFilterCount === 0}
        >
          <X className="h-4 w-4 mr-1" />
          Clear All
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Text Search */}
        <div className="space-y-2">
          <Label htmlFor="search" className="text-pd-accent">Search</Label>
          <Input
            id="search"
            placeholder="SKU, Name, Barcode..."
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            className={inputClasses}
          />
        </div>

        {/* Brand Filter */}
        <div className="space-y-2">
          <Label htmlFor="brand" className="text-pd-accent">Brand</Label>
          <Select value={filters.brand || "all"} onValueChange={(value) => updateFilter("brand", value === "all" ? "" : value)}>
            <SelectTrigger id="brand" className={inputClasses}>
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

        {/* Status Filter */}
        <div className="space-y-2">
          <Label htmlFor="status" className="text-pd-accent">Status</Label>
          <Select value={filters.status || "all"} onValueChange={(value) => updateFilter("status", value === "all" ? "" : value)}>
            <SelectTrigger id="status" className={inputClasses}>
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="discontinued">Discontinued</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date Range - Last Synced From */}
        <div className="space-y-2">
          <Label htmlFor="lastSyncedFrom" className="text-pd-accent">Last Synced From</Label>
          <Input
            id="lastSyncedFrom"
            type="date"
            value={filters.lastSyncedFrom}
            onChange={(e) => updateFilter("lastSyncedFrom", e.target.value)}
            className={inputClasses}
          />
        </div>

        {/* Date Range - Last Synced To */}
        <div className="space-y-2">
          <Label htmlFor="lastSyncedTo" className="text-pd-accent">Last Synced To</Label>
          <Input
            id="lastSyncedTo"
            type="date"
            value={filters.lastSyncedTo}
            onChange={(e) => updateFilter("lastSyncedTo", e.target.value)}
            className={inputClasses}
          />
        </div>

        {/* Stock Range */}
        <div className="space-y-2">
          <Label className="text-pd-accent">Current Stock: {filters.stockMin} - {filters.stockMax}</Label>
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              placeholder="Min"
              value={filters.stockMin}
              onChange={(e) => updateFilter("stockMin", Number(e.target.value))}
              className={`w-20 ${inputClasses}`}
            />
            <span className="text-white/70">to</span>
            <Input
              type="number"
              placeholder="Max"
              value={filters.stockMax}
              onChange={(e) => updateFilter("stockMax", Number(e.target.value))}
              className={`w-20 ${inputClasses}`}
            />
          </div>
        </div>

        {/* Back Order Range */}
        <div className="space-y-2">
          <Label className="text-pd-accent">Back Orders: {filters.backOrderMin} - {filters.backOrderMax}</Label>
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              placeholder="Min"
              value={filters.backOrderMin}
              onChange={(e) => updateFilter("backOrderMin", Number(e.target.value))}
              className={`w-20 ${inputClasses}`}
            />
            <span className="text-white/70">to</span>
            <Input
              type="number"
              placeholder="Max"
              value={filters.backOrderMax}
              onChange={(e) => updateFilter("backOrderMax", Number(e.target.value))}
              className={`w-20 ${inputClasses}`}
            />
          </div>
        </div>

        {/* Cost Price Range */}
        <div className="space-y-2">
          <Label className="text-pd-accent">Cost Price: £{filters.costPriceMin} - £{filters.costPriceMax}</Label>
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              placeholder="Min"
              value={filters.costPriceMin}
              onChange={(e) => updateFilter("costPriceMin", Number(e.target.value))}
              className={`w-20 ${inputClasses}`}
            />
            <span className="text-white/70">to</span>
            <Input
              type="number"
              placeholder="Max"
              value={filters.costPriceMax}
              onChange={(e) => updateFilter("costPriceMax", Number(e.target.value))}
              className={`w-20 ${inputClasses}`}
            />
          </div>
        </div>

        {/* Has Images Filter */}
        <div className="space-y-2 flex items-end">
          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id="hasImages"
              checked={filters.hasImages}
              onCheckedChange={(checked) => updateFilter("hasImages", !!checked)}
            />
            <Label htmlFor="hasImages" className="text-pd-accent cursor-pointer">
              Has Images Only
            </Label>
          </div>
        </div>
      </div>
    </div>
  );
};
