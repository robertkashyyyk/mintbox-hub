import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";

const CarrierDocuments = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Carrier Documents</h1>
        <p className="text-muted-foreground mt-1">
          Upload courier invoices and penalty notices. AI extracts the line items automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <CardTitle>Coming next</CardTitle>
          </div>
          <CardDescription>
            Drag-and-drop PDF upload, AI parsing, and a library of all uploaded documents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Phase 2 — being built next.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default CarrierDocuments;
