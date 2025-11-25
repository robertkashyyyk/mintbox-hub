import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const DiagnosticBanner = () => {
  return (
    <Alert className="mb-6 border-amber-500/50 bg-amber-500/10">
      <AlertTriangle className="h-4 w-4 text-amber-500" />
      <AlertDescription className="text-amber-700 dark:text-amber-400">
        <strong>Diagnostic / Developer Area</strong> – for troubleshooting and audits. 
        For insights, use the Intelligence and Decisions modules.
      </AlertDescription>
    </Alert>
  );
};

export default DiagnosticBanner;
