import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import DiagnosticBanner from "@/components/DiagnosticBanner";

const LogsDiagnostics = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Logs / Diagnostics</h2>
        <p className="text-muted-foreground">
          System logs and diagnostic information.
        </p>
      </div>

      <DiagnosticBanner />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-slate-500" />
            <CardTitle>Coming Soon</CardTitle>
          </div>
          <CardDescription>
            This module will provide access to system logs, error tracking, and diagnostic 
            information for troubleshooting and auditing purposes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Planned features:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>System log viewer with filtering</li>
              <li>Error tracking and alerting</li>
              <li>API call logs and performance metrics</li>
              <li>Audit trail for user actions</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LogsDiagnostics;
