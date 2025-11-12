import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, PlayCircle, Clock, CheckCircle2, XCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SyncJob {
  id: string;
  brand_id: string;
  status: string;
  report_type: string;
  items_count: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  brands: {
    name: string;
  };
}

export const SyncControl = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedBrand, setSelectedBrand] = useState<string>("");

  // Fetch brands
  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("*")
        .order("name");

      if (error) throw error;
      return data;
    },
  });

  // Fetch sync jobs
  const { data: syncJobs = [] } = useQuery({
    queryKey: ["sync-jobs"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("sync_jobs")
        .select("*, brands(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as SyncJob[];
    },
  });

  // Start sync mutation
  const startSyncMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBrand) {
        throw new Error("Please select a brand");
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create sync job
      const { data: job, error: jobError } = await supabase
        .from("sync_jobs")
        .insert({
          user_id: user.id,
          brand_id: selectedBrand,
          report_type: "Inventory",
          status: "pending"
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Trigger edge function
      const { error: fnError } = await supabase.functions.invoke('sync-brand-inventory', {
        body: { job_id: job.id }
      });

      if (fnError) throw fnError;

      return job;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sync-jobs"] });
      toast({
        title: "Sync started",
        description: "Your inventory sync has been queued. You'll be notified when it's ready.",
      });
      setSelectedBrand("");
    },
    onError: (error: Error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete sync job mutation
  const deleteSyncMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from("sync_jobs")
        .delete()
        .eq("id", jobId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sync-jobs"] });
      toast({
        title: "Job deleted",
        description: "Sync job removed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Subscribe to realtime job updates
  useEffect(() => {
    const channel = supabase
      .channel('sync-jobs-channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sync_jobs'
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["sync-jobs"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'complete':
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "secondary",
      processing: "default",
      complete: "outline",
      error: "destructive"
    };
    
    return (
      <Badge variant={variants[status] || "default"} className="flex items-center gap-1">
        {getStatusIcon(status)}
        {status}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync Inventory</CardTitle>
        <CardDescription>
          Select a brand to sync its inventory from Mintsoft. You'll receive an email and notification when it's ready.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-4">
          <div className="flex-1 space-y-2">
            <Label htmlFor="brand-sync-select">Select Brand</Label>
            <Select value={selectedBrand} onValueChange={setSelectedBrand}>
              <SelectTrigger id="brand-sync-select">
                <SelectValue placeholder="Choose a brand to sync" />
              </SelectTrigger>
              <SelectContent>
                {brands.map((brand) => (
                  <SelectItem key={brand.id} value={brand.id}>
                    {brand.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => startSyncMutation.mutate()}
              disabled={!selectedBrand || startSyncMutation.isPending}
            >
              {startSyncMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Start Sync
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Recent Sync Jobs</h3>
          <ScrollArea className="h-64 border rounded-md">
            {syncJobs.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No sync jobs yet
              </div>
            ) : (
              <div className="divide-y">
                {syncJobs.map((job) => (
                  <div key={job.id} className="p-4 space-y-2 relative group">
                    {/* Delete button - only show for failed jobs */}
                    {job.status === 'error' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 left-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => deleteSyncMutation.mutate(job.id)}
                        disabled={deleteSyncMutation.isPending}
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                    
                    <div className="flex items-center justify-between pl-8">
                      <span className="font-medium">{job.brands.name}</span>
                      {getStatusBadge(job.status)}
                    </div>
                    <div className="text-sm text-muted-foreground pl-8">
                      {job.status === 'complete' && (
                        <span>✓ {job.items_count} items synced</span>
                      )}
                      {job.status === 'error' && (
                        <span className="text-destructive">Error: {job.error_message}</span>
                      )}
                      {(job.status === 'pending' || job.status === 'processing') && (
                        <span>In progress...</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground pl-8">
                      Started: {new Date(job.created_at).toLocaleString()}
                      {job.completed_at && (
                        <> • Completed: {new Date(job.completed_at).toLocaleString()}</>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
};
