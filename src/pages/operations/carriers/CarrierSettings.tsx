import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";

const CarrierSettings = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Carrier Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage carriers, reason code labels, and packer roster for assignments.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <CardTitle>Coming soon</CardTitle>
          </div>
          <CardDescription>
            Carriers list (Royal Mail seeded), editable reason code library, and packer roster.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Phase 5 — final piece of the module.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default CarrierSettings;
