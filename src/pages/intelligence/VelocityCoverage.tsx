import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

const VelocityCoverage = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Velocity & Coverage</h2>
        <p className="text-muted-foreground">
          Sales velocity and inventory coverage analysis.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-500" />
            <CardTitle>Coming Soon</CardTitle>
          </div>
          <CardDescription>
            This module will provide insights into product sales velocity, inventory turnover rates, 
            and coverage analysis to help you understand which products are moving fast and which need attention.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Planned features:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>30/60/90-day sales velocity by product and brand</li>
              <li>Inventory coverage analysis (days of supply)</li>
              <li>Fast movers vs. slow movers identification</li>
              <li>Velocity trends and seasonality patterns</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default VelocityCoverage;
