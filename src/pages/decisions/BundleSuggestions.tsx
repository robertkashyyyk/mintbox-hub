import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Package } from "lucide-react";

const BundleSuggestions = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white">Bundle Suggestions</h2>
        <p className="text-white/60">
          Product combinations for bundling opportunities.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-purple-500" />
            <CardTitle>Coming Soon</CardTitle>
          </div>
          <CardDescription>
            This module will analyze order patterns and product relationships to suggest 
            bundling opportunities that can increase average order value.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Planned features:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Frequently bought together analysis</li>
              <li>Complementary product identification</li>
              <li>Bundle pricing optimization</li>
              <li>Cross-brand bundle opportunities</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BundleSuggestions;
