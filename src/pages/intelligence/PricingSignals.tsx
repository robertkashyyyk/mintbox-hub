import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";

const PricingSignals = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Pricing Signals</h2>
        <p className="text-muted-foreground">
          Market pricing trends and competitor intelligence.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-emerald-500" />
            <CardTitle>Coming Soon</CardTitle>
          </div>
          <CardDescription>
            This module will aggregate pricing data from Price Hunter to provide competitive intelligence 
            and identify pricing opportunities across your catalog.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Planned features:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Competitive pricing gap analysis</li>
              <li>Market price trend tracking</li>
              <li>Margin compression alerts</li>
              <li>Pricing opportunity identification</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PricingSignals;
