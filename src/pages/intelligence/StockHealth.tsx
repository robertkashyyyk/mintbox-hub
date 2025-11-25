import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";

const StockHealth = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Stock Health</h2>
        <p className="text-muted-foreground">
          Stock levels, overstock, and shortage analysis.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-500" />
            <CardTitle>Coming Soon</CardTitle>
          </div>
          <CardDescription>
            This module will analyze your stock health, identifying overstock situations, 
            stockout risks, and optimal reorder points for each product.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Planned features:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Overstock identification and aging analysis</li>
              <li>Stockout risk alerts based on velocity</li>
              <li>Optimal reorder point calculations</li>
              <li>Dead stock and obsolescence tracking</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StockHealth;
