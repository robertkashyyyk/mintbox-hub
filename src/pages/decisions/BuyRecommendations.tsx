import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingBag } from "lucide-react";

const BuyRecommendations = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Buy Recommendations</h2>
        <p className="text-muted-foreground">
          AI-driven purchase order suggestions based on velocity.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-blue-500" />
            <CardTitle>Coming Soon</CardTitle>
          </div>
          <CardDescription>
            This module will analyze sales velocity, stock levels, and lead times to provide 
            intelligent purchase order recommendations for each product.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Planned features:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Velocity-based reorder quantity suggestions</li>
              <li>Lead time-aware purchase timing</li>
              <li>Supplier performance integration</li>
              <li>Economic order quantity (EOQ) calculations</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BuyRecommendations;
