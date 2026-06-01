import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";

const BillingUsage = () => {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Billing & Usage"
        description="View Xask usage and billing information."
        icon={CreditCard}
      />

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
