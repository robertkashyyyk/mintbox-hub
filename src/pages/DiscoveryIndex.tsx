import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Tag, AlertCircle, Activity, FileText, Images, Clock, Search, Sparkles, PackagePlus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ModuleHeader from "@/components/ModuleHeader";
import discoveryBanner from "@/assets/banners/discovery-banner.jpg";
import { getNavGroup } from "@/config/navigation";

const DiscoveryIndex = () => {
  const navigate = useNavigate();

  const { data: userRoles } = useQuery({
    queryKey: ["current-user-roles"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (error) throw error;
      return data;
    },
  });

  const isSuperUser = userRoles?.some((r: any) => r.role === "super_user");

  // Single source of truth — see src/config/navigation.tsx
  const options = (getNavGroup("Discovery")?.items ?? []).map((it) => ({
    title: it.title, description: it.description, icon: it.icon,
    onClick: () => navigate(it.url), show: true,
  }));

  return (
    <div className="space-y-2">
      <ModuleHeader
        title="Discovery"
        description="See and manage products, brands, and ingested data."
        icon={Search}
        backgroundImage={discoveryBanner}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {options.filter(o => o.show).map((option) => (
          <Card
            key={option.title}
            className="cursor-pointer bg-card hover:bg-card/80 hover:border-pd-accent/60 transition-colors duration-150 group"
            onClick={option.onClick}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <option.icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-base">{option.title}</CardTitle>
              </div>
              <CardDescription className="text-xs">{option.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default DiscoveryIndex;
