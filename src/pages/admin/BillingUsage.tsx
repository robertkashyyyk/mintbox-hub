import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard } from "lucide-react";

const BillingUsage = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white">Billing & Usage</h2>
        <p className="text-white/60">
          View Xask usage and billing information.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-purple-500" />
            <CardTitle>Coming Soon</CardTitle>
          </div>
          <CardDescription>
            This module will display your Price Hunter Xask consumption, usage trends, 
            and billing details for cost management and forecasting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Planned features:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Monthly Xask usage summary and trends</li>
              <li>Usage breakdown by brand and source</li>
              <li>Cost forecasting based on automation schedules</li>
              <li>Historical billing and invoice access</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BillingUsage;
