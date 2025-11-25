import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDown } from "lucide-react";

const PriceMoves = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Price Moves</h2>
        <p className="text-muted-foreground">
          Suggested pricing adjustments for competitiveness.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-green-500" />
            <CardTitle>Coming Soon</CardTitle>
          </div>
          <CardDescription>
            This module will analyze Price Hunter data and market conditions to recommend 
            pricing adjustments that balance competitiveness with profitability.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Planned features:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Competitive price gap alerts</li>
              <li>Dynamic pricing recommendations</li>
              <li>Margin-aware price adjustments</li>
              <li>Bulk price change suggestions</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PriceMoves;
