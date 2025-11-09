import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface OrderTrackingProps {
  selectedBrand: string;
  userId: string;
}

export const OrderTracking = ({ selectedBrand, userId }: OrderTrackingProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: orders = [] } = useQuery({
    queryKey: ["order-tracking", selectedBrand],
    queryFn: async () => {
      if (!selectedBrand) return [];

      const { data, error } = await supabase
        .from("order_tracking")
        .select(`
          *,
          brands(name)
        `)
        .eq("brand_id", selectedBrand)
        .gte("order_date", format(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), "yyyy-MM-dd"))
        .order("order_date", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!selectedBrand,
  });

  const updateOrderMutation = useMutation({
    mutationFn: async ({ orderId, placed }: { orderId: string; placed: boolean }) => {
      const { error } = await supabase
        .from("order_tracking")
        .update({ placed })
        .eq("id", orderId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-tracking"] });
      toast({
        title: "Updated",
        description: "Order status updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  const createOrderMutation = useMutation({
    mutationFn: async (date: string) => {
      const { error } = await supabase.from("order_tracking").insert({
        user_id: userId,
        brand_id: selectedBrand,
        order_date: date,
        placed: true,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-tracking"] });
      toast({
        title: "Created",
        description: "Order marked as placed.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  const handleCheckboxChange = async (checked: boolean, date: string) => {
    const existingOrder = orders.find(
      (o) => o.order_date === date
    );

    if (existingOrder) {
      updateOrderMutation.mutate({
        orderId: existingOrder.id,
        placed: checked,
      });
    } else if (checked) {
      createOrderMutation.mutate(date);
    }
  };

  const getLastSevenDays = () => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      dates.push(format(date, "yyyy-MM-dd"));
    }
    return dates;
  };

  const dates = getLastSevenDays();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order Tracking</CardTitle>
        <CardDescription>
          {selectedBrand
            ? "Mark which days you've placed orders"
            : "Select a brand to track orders"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!selectedBrand ? (
          <p className="text-sm text-muted-foreground">Please select a brand first.</p>
        ) : (
          <div className="space-y-3">
            {dates.map((date) => {
              const order = orders.find((o) => o.order_date === date);
              const isChecked = order?.placed || false;

              return (
                <div key={date} className="flex items-center space-x-3">
                  <Checkbox
                    id={`order-${date}`}
                    checked={isChecked}
                    onCheckedChange={(checked) =>
                      handleCheckboxChange(checked as boolean, date)
                    }
                  />
                  <Label
                    htmlFor={`order-${date}`}
                    className="text-sm font-normal cursor-pointer flex-1"
                  >
                    {format(new Date(date), "EEEE, MMMM d, yyyy")}
                  </Label>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
