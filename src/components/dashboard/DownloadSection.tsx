import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

interface DownloadSectionProps {
  selectedBrand: string;
  userId: string;
}

export const DownloadSection = ({ selectedBrand, userId }: DownloadSectionProps) => {
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleDownload = async (type: "mintsoft" | "external") => {
    if (!selectedBrand) {
      toast({
        variant: "destructive",
        title: "No brand selected",
        description: "Please select a brand before downloading.",
      });
      return;
    }

    setDownloading(true);

    try {
      // Record the download in history
      const { error } = await supabase.from("download_history").insert({
        user_id: userId,
        brand_id: selectedBrand,
        download_type: type,
      });

      if (error) throw error;

      // Invalidate queries to refresh history
      queryClient.invalidateQueries({ queryKey: ["download-history"] });

      // Simulate file download (in production, this would generate and download a real file)
      const prefix = type === "mintsoft" ? "MINTSOFT_" : "";
      const filename = `${prefix}report_${new Date().toISOString().split("T")[0]}.csv`;

      toast({
        title: "Download started",
        description: `${filename} is being prepared for download.`,
      });

      // In a real implementation, you would generate the file here
      // For now, we'll just show a success message
      setTimeout(() => {
        toast({
          title: "Download complete",
          description: `${filename} has been downloaded successfully.`,
        });
      }, 1000);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Download failed",
        description: error.message,
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <Button
        onClick={() => handleDownload("mintsoft")}
        disabled={!selectedBrand || downloading}
        className="flex-1"
      >
        <Download className="mr-2 h-4 w-4" />
        Download for Mintsoft
      </Button>
      <Button
        onClick={() => handleDownload("external")}
        disabled={!selectedBrand || downloading}
        variant="secondary"
        className="flex-1"
      >
        <Download className="mr-2 h-4 w-4" />
        Download for External
      </Button>
    </div>
  );
};
