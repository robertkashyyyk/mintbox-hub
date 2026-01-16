import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import { format } from "date-fns";

interface UploadHistoryItem {
  id: string;
  upload_name: string;
  uploaded_at: string;
  items_imported: number;
  status: string;
  error_message: string | null;
  source: string;
  prefix: string | null;
}

export function ImportHistory() {
  const { data: history, isLoading } = useQuery({
    queryKey: ["import-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("upload_history")
        .select("*")
        .order("uploaded_at", { ascending: false });

      if (error) throw error;
      return data as UploadHistoryItem[];
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Import History</CardTitle>
          <CardDescription>Loading import history...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!history || history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Import History</CardTitle>
          <CardDescription>No imports yet. Use Product PUSH or PULL to add products.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import History</CardTitle>
        <CardDescription>
          Track all product imports - both manual uploads (PUSH) and Mintsoft pulls (PULL)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {history.map((item) => {
            const isPull = item.source === "pull";
            
            return (
              <div
                key={item.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {/* Source Badge */}
                  <div className="flex flex-col items-center gap-1">
                    {isPull ? (
                      <Badge 
                        variant="outline" 
                        className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
                      >
                        <ArrowDownCircle className="h-3 w-3 mr-1" />
                        PULL
                      </Badge>
                    ) : (
                      <Badge 
                        variant="outline" 
                        className="bg-blue-500/10 text-blue-600 border-blue-500/30 dark:text-blue-400"
                      >
                        <ArrowUpCircle className="h-3 w-3 mr-1" />
                        PUSH
                      </Badge>
                    )}
                  </div>

                  {/* Status Icon */}
                  {item.status === "success" ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : item.status === "error" ? (
                    <XCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  )}

                  {/* Details */}
                  <div>
                    <p className="font-medium">{item.upload_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(item.uploaded_at), "PPp")}
                      {isPull && item.prefix && (
                        <span className="ml-2 font-mono bg-muted px-1 rounded">
                          {item.prefix}
                        </span>
                      )}
                    </p>
                    {item.error_message && (
                      <p className="text-xs text-destructive mt-1">
                        {item.error_message}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right side stats */}
                <div className="text-right">
                  <p className="text-sm font-medium">
                    {item.items_imported.toLocaleString()} SKUs
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {item.status}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
