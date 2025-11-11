import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CheckCircle, XCircle, Clock, Loader2, Download, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface SyncJob {
  id: string;
  status: string;
  brand_id: string;
  items_count: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  brands: {
    name: string;
  };
}

export const SyncHistory = () => {
  const { toast } = useToast();

  const { data: syncJobs, isLoading } = useQuery({
    queryKey: ['sync-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sync_jobs')
        .select('*, brands(name)')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as SyncJob[];
    },
  });

  const handleDownload = async (jobId: string, format: 'mintsoft' | 'external') => {
    try {
      toast({
        title: "Generating report...",
        description: `Preparing ${format} format download`,
      });

      const { data, error } = await supabase.functions.invoke('download-sync-report', {
        body: { job_id: jobId, format },
      });

      if (error) throw error;

      // Create blob and trigger download
      const blob = new Blob([data.content], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Download started",
        description: `${data.filename} is downloading`,
      });
    } catch (error: any) {
      toast({
        title: "Download failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'complete':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      complete: "default",
      processing: "secondary",
      error: "destructive",
      pending: "outline",
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync History</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : syncJobs && syncJobs.length > 0 ? (
            <div className="space-y-3">
              {syncJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start gap-3 flex-1">
                    {getStatusIcon(job.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium truncate">{job.brands.name}</p>
                        {getStatusBadge(job.status)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(job.created_at), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                      {job.status === 'complete' && (
                        <p className="text-sm text-muted-foreground">
                          {job.items_count} items synced
                        </p>
                      )}
                      {job.error_message && (
                        <p className="text-sm text-destructive mt-1">{job.error_message}</p>
                      )}
                    </div>
                  </div>
                  
                  {job.status === 'complete' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="ml-2">
                          <Download className="h-4 w-4 mr-2" />
                          Download
                          <ChevronDown className="h-4 w-4 ml-2" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleDownload(job.id, 'mintsoft')}>
                          Mintsoft Format
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDownload(job.id, 'external')}>
                          External Format
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No sync history yet
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
