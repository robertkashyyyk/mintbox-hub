import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";

interface BrandAutomationPanelProps {
  brandId: string;
  brandName: string;
  currentFilteredCount: number;
}

export function BrandAutomationPanel({
  brandId,
  brandName,
  currentFilteredCount,
}: BrandAutomationPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(true);
  const [intervalDays, setIntervalDays] = useState("14");
  const [includeOnlyInStock, setIncludeOnlyInStock] = useState(true);
  const [includeFireSaleOnly, setIncludeFireSaleOnly] = useState(false);

  // Fetch automation for this brand
  const { data: automation, isLoading } = useQuery({
    queryKey: ["price-hunter-automation", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_hunter_automations")
        .select("*")
        .eq("brand_id", brandId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!brandId,
  });

  // Update form when automation data loads
  useEffect(() => {
    if (automation) {
      setEnabled(automation.enabled);
      setIntervalDays(automation.interval_days.toString());
      setIncludeOnlyInStock(automation.include_only_in_stock);
      setIncludeFireSaleOnly(automation.include_fire_sale_only);
    }
  }, [automation]);

  // Save automation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        brand_id: brandId,
        brand_name: brandName,
        enabled,
        interval_days: parseInt(intervalDays),
        include_only_in_stock: includeOnlyInStock,
        include_fire_sale_only: includeFireSaleOnly,
      };

      const { data, error } = await supabase
        .from("price_hunter_automations")
        .upsert(payload, { onConflict: "brand_id" })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-hunter-automation"] });
      toast({
        title: "Saved",
        description: "Brand automation settings updated",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const runsPerMonth = 30 / parseInt(intervalDays);
  const xasksPerRun = currentFilteredCount;
  const monthlyXasks = Math.round(runsPerMonth * xasksPerRun);

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-lg mb-1">
          Brand Automation: {brandName}
        </h3>
        <p className="text-sm text-muted-foreground">
          Configure automatic price checking for this brand
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="automation-enabled">Enable automation</Label>
              <Switch
                id="automation-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            <div className="space-y-2">
              <Label>Interval</Label>
              <Select value={intervalDays} onValueChange={setIntervalDays}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Every 7 days</SelectItem>
                  <SelectItem value="14">Every 14 days</SelectItem>
                  <SelectItem value="30">Every 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="only-in-stock"
                checked={includeOnlyInStock}
                onCheckedChange={(checked) =>
                  setIncludeOnlyInStock(checked as boolean)
                }
              />
              <Label htmlFor="only-in-stock" className="cursor-pointer">
                Only queue SKUs with stock
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="fire-sale-only"
                checked={includeFireSaleOnly}
                onCheckedChange={(checked) =>
                  setIncludeFireSaleOnly(checked as boolean)
                }
              />
              <Label htmlFor="fire-sale-only" className="cursor-pointer">
                Fire sale SKUs only
              </Label>
            </div>
          </div>

          {automation && (
            <div className="space-y-2 text-sm border-t pt-4">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last run:</span>
                <span className="font-medium">
                  {automation.last_run_at
                    ? format(new Date(automation.last_run_at), "MMM d, HH:mm")
                    : "Never"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last run processed:</span>
                <span className="font-medium">
                  {automation.last_run_sku_count || 0} SKUs
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Next run:</span>
                <span className="font-medium">
                  {automation.next_run_at
                    ? format(new Date(automation.next_run_at), "MMM d, HH:mm")
                    : "Not scheduled"}
                </span>
              </div>
            </div>
          )}

          <div className="bg-muted/50 p-3 rounded-md text-sm space-y-1">
            <p className="font-medium">Estimated usage</p>
            <p className="text-muted-foreground">
              ~{monthlyXasks} Xasks/month for this brand
            </p>
            <p className="text-xs text-muted-foreground">
              Based on current SKU count ({currentFilteredCount}) and interval ({intervalDays} days).
              1 Xask = 1 Price Hunter run for 1 SKU.
            </p>
          </div>

          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full"
          >
            {saveMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save Automation
          </Button>
        </>
      )}
    </Card>
  );
}