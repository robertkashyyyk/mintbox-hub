import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";

export const ProductUploadHistory = () => {
  const { data: history, isLoading } = useQuery({
    queryKey: ["upload-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("upload_history")
        .select("*")
        .order("uploaded_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upload History</CardTitle>
          <CardDescription>Loading upload history...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!history || history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upload History</CardTitle>
          <CardDescription>No uploads yet</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload History</CardTitle>
        <CardDescription>Track your product upload history</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {history.map((upload) => (
            <div
              key={upload.id}
              className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                {upload.status === "success" ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : upload.status === "error" ? (
                  <XCircle className="h-5 w-5 text-destructive" />
                ) : (
                  <Clock className="h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <p className="font-medium">{upload.upload_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(upload.uploaded_at), "PPp")}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">
                  {upload.items_imported} SKUs
                </p>
                <p className="text-xs text-muted-foreground capitalize">
                  {upload.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
