import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";

const FEED_TYPES = {
  no_feed: "No feed available",
  email: "Email",
  google_sheet: "Google Sheet",
  direct_upload: "Direct Upload",
  ftp_push: "FTP Push",
  ftp_pull: "FTP Pull",
} as const;

type FeedType = keyof typeof FEED_TYPES;

const RemoteStockUpdates = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: brands, isLoading } = useQuery({
    queryKey: ["brands-remote-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, remote_stock_feed_type")
        .order("name");

      if (error) throw error;
      return data;
    },
  });

  const updateFeedTypeMutation = useMutation({
    mutationFn: async ({ brandId, feedType }: { brandId: string; feedType: FeedType }) => {
      const { error } = await supabase
        .from("brands")
        .update({ remote_stock_feed_type: feedType })
        .eq("id", brandId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands-remote-stock"] });
      toast({
        title: "Success",
        description: "Feed type updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to update feed type",
        variant: "destructive",
      });
      console.error("Error updating feed type:", error);
    },
  });

  const handleFeedTypeChange = (brandId: string, feedType: string) => {
    updateFeedTypeMutation.mutate({
      brandId,
      feedType: feedType as FeedType,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Remote Stock Updates</h1>
        <p className="text-muted-foreground mt-2">
          Configure how each brand delivers stock updates to the system
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Brand Feed Configuration</CardTitle>
          <CardDescription>
            Assign a feed type to each brand to enable remote stock updates
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brand Name</TableHead>
                  <TableHead>Current Feed Type</TableHead>
                  <TableHead>Assign Feed Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {brands?.map((brand) => (
                  <TableRow key={brand.id}>
                    <TableCell className="font-medium">{brand.name}</TableCell>
                    <TableCell>
                      {!brand.remote_stock_feed_type ? (
                        <div className="flex items-center gap-2 text-destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="font-medium">No Feed Assigned</span>
                        </div>
                      ) : (
                        <span className="font-medium">
                          {FEED_TYPES[brand.remote_stock_feed_type as FeedType]}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={brand.remote_stock_feed_type || ""}
                        onValueChange={(value) => handleFeedTypeChange(brand.id, value)}
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue placeholder="Select feed type" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(FEED_TYPES).map(([key, label]) => (
                            <SelectItem key={key} value={key}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default RemoteStockUpdates;
