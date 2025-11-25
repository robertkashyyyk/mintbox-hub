import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "lucide-react";

const Seasonality = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Seasonality</h2>
        <p className="text-muted-foreground">
          Seasonal demand patterns and forecasts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-purple-500" />
            <CardTitle>Coming Soon</CardTitle>
          </div>
          <CardDescription>
            This module will analyze historical sales data to identify seasonal patterns 
            and help you prepare for peak demand periods.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Planned features:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Month-over-month and year-over-year comparisons</li>
              <li>Seasonal demand pattern identification</li>
              <li>Peak season forecasting</li>
              <li>Pre-season stocking recommendations</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Seasonality;
