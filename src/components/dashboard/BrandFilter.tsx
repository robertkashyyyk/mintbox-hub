import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface BrandFilterProps {
  selectedBrand: string;
  onBrandChange: (brand: string) => void;
}

export const BrandFilter = ({ selectedBrand, onBrandChange }: BrandFilterProps) => {
  const { data: brands = [] } = useQuery({
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

  return (
    <div className="space-y-2">
      <Label htmlFor="brand-select">Select Brand</Label>
      <Select value={selectedBrand} onValueChange={onBrandChange}>
        <SelectTrigger id="brand-select">
          <SelectValue placeholder="Choose a brand" />
        </SelectTrigger>
        <SelectContent>
          {brands.map((brand) => (
            <SelectItem key={brand.id} value={brand.id}>
              {brand.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
