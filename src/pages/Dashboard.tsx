import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DownloadHistory } from "@/components/dashboard/DownloadHistory";
import { OrderTracking } from "@/components/dashboard/OrderTracking";
import { SyncControl } from "@/components/dashboard/SyncControl";
import { SyncHistory } from "@/components/dashboard/SyncHistory";

const Dashboard = () => {
  const [selectedBrand, setSelectedBrand] = useState<string>("");

  const { data: session } = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return session;
    },
  });

  return (
    <div className="space-y-8">
      <SyncControl />

      <SyncHistory />

      <div className="grid gap-8 md:grid-cols-2">
        <DownloadHistory />
        <OrderTracking selectedBrand={selectedBrand} userId={session?.user.id || ""} />
      </div>
    </div>
  );
};

export default Dashboard;
