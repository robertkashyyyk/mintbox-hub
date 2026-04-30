import { useNavigate } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, BarChart3, Sparkles, PlayCircle, Users, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { SystemHealthStrip } from "@/components/SystemHealthStrip";

const MainMenu = () => {
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
  const isSeniorUser = userRoles?.some((r: any) => r.role === "senior_user");

  const sections = [
    { title: "Discovery", description: "See and manage products, brands, and ingested data.", icon: Search, path: "/discovery", show: true },
    { title: "Intelligence", description: "Velocity, stock health and coverage insights.", icon: BarChart3, path: "/intelligence", show: true },
    { title: "Decisions", description: "AI-driven buying, pricing and liquidation recommendations.", icon: Sparkles, path: "/decisions", show: isSeniorUser || isSuperUser },
    { title: "Execution", description: "Execute purchase, pricing and listing actions.", icon: PlayCircle, path: "/execution", show: isSeniorUser || isSuperUser },
    { title: "Operations", description: "Order monitoring, sync status, and system health.", icon: Activity, path: "/operations", show: isSeniorUser || isSuperUser },
    { title: "Dashboards", description: "Warehouse performance, packing area and weekly summary.", icon: BarChart3, path: "/dashboards", show: isSeniorUser || isSuperUser },
    { title: "Administration", description: "User management, API keys and billing.", icon: Users, path: "/admin", show: isSuperUser },
  ];

  return (
    <div className="space-y-2">
      {/* Visual welcome banner */}
      <div className="relative w-full h-40 md:h-48 rounded-xl overflow-hidden mb-8 bg-gradient-to-br from-[hsl(var(--pd-charcoal))] via-[hsl(var(--pd-graphite))] to-[hsl(var(--pd-charcoal))]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--pd-accent)/0.15),transparent_70%)]" />
        <div className="relative h-full flex items-center px-8 md:px-12">
          <div className="flex items-center gap-5">
            <div className="hidden md:block h-16 w-1 rounded-full bg-pd-accent" />
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-lg bg-pd-accent flex items-center justify-center">
                  <span className="text-foreground font-bold text-lg">PD</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">PartsDoc Hub</h1>
              </div>
              <p className="text-sm md:text-base text-foreground/60">Select a module to get started</p>
            </div>
          </div>
        </div>
      </div>

      <SystemHealthStrip />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sections.filter(s => s.show).map((section) => (
          <Card
            key={section.title}
            className="cursor-pointer bg-card hover:border-primary/50 transition-all hover:shadow-lg group"
            onClick={() => navigate(section.path)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <section.icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-base">{section.title}</CardTitle>
              </div>
              <CardDescription className="text-xs">{section.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default MainMenu;
