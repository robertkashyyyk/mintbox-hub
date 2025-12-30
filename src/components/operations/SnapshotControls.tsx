import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface SnapshotResult {
  status: string;
  results?: {
    order_snapshot?: { status: string; counts?: Record<string, number>; slot?: string };
    backorder_snapshot?: { status: string; total_onbackorder?: number };
  };
  error?: string;
}

export function SnapshotControls() {
  const queryClient = useQueryClient();
  const [slot, setSlot] = useState<string>("AM");
  const [runOrderSnapshot, setRunOrderSnapshot] = useState(true);
  const [runBackorderSnapshot, setRunBackorderSnapshot] = useState(true);

  const runSnapshotsMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<SnapshotResult>(
        "admin-run-snapshots",
        {
          body: {
            slot,
            order_snapshot: runOrderSnapshot,
            backorder_snapshot: runBackorderSnapshot,
          },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["order-status-snapshot-today"] });
      queryClient.invalidateQueries({ queryKey: ["order-status-snapshot-latest"] });
      queryClient.invalidateQueries({ queryKey: ["backorder-snapshot-today"] });
      queryClient.invalidateQueries({ queryKey: ["backorder-snapshot-latest"] });

      const results = data?.results;
      let message = "Snapshots run completed.";
      
      if (results?.order_snapshot?.status === "already_exists") {
        message += ` Order snapshot (${slot}) already exists.`;
      } else if (results?.order_snapshot?.status === "success") {
        message += ` Order snapshot (${slot}) captured.`;
      }
      
      if (results?.backorder_snapshot?.status === "already_exists") {
        message += " Backorder snapshot already exists.";
      } else if (results?.backorder_snapshot?.status === "success") {
        message += ` Backorder snapshot captured (${results.backorder_snapshot.total_onbackorder} orders).`;
      }

      toast.success(message);
    },
    onError: (error: Error) => {
      console.error("Snapshot run failed:", error);
      toast.error(`Snapshot run failed: ${error.message}`);
    },
  });

  const isLoading = runSnapshotsMutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Manual Snapshot Controls
        </CardTitle>
        <CardDescription>
          Run order status and backorder snapshots manually (admin only)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="slot-select" className="text-sm whitespace-nowrap">
              Slot:
            </Label>
            <Select value={slot} onValueChange={setSlot}>
              <SelectTrigger id="slot-select" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AM">AM</SelectItem>
                <SelectItem value="PM">PM</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="order-snapshot"
              checked={runOrderSnapshot}
              onCheckedChange={(checked) => setRunOrderSnapshot(checked === true)}
            />
            <Label htmlFor="order-snapshot" className="text-sm cursor-pointer">
              Order Status
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="backorder-snapshot"
              checked={runBackorderSnapshot}
              onCheckedChange={(checked) => setRunBackorderSnapshot(checked === true)}
            />
            <Label htmlFor="backorder-snapshot" className="text-sm cursor-pointer">
              Backorder Age
            </Label>
          </div>
        </div>

        <Button
          onClick={() => runSnapshotsMutation.mutate()}
          disabled={isLoading || (!runOrderSnapshot && !runBackorderSnapshot)}
          className="w-full sm:w-auto"
        >
          {isLoading ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Run Snapshots Now
            </>
          )}
        </Button>

        {runSnapshotsMutation.isSuccess && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <span>Last run completed successfully</span>
          </div>
        )}

        {runSnapshotsMutation.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{runSnapshotsMutation.error?.message}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
