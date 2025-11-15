import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart, Database, RefreshCw, Tag, UserCircle, AlertCircle, Wrench, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

const MainMenu = () => {
  const navigate = useNavigate();

  // Check if user is super user
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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const sections = [
    {
      title: "Ordering",
      description: "Order management and inventory tools",
      icon: ShoppingCart,
      color: "text-blue-500",
      path: "/menu/ordering",
      show: true,
    },
    {
      title: "SKU Section",
      description: "Manage and view your product catalog",
      icon: Database,
      color: "text-green-500",
      path: "/menu/sku-section",
      show: true,
    },
    {
      title: "Stock Updates",
      description: "Manage stock synchronization and updates",
      icon: RefreshCw,
      color: "text-cyan-500",
      path: "/menu/stock-updates",
      show: isSuperUser || isSeniorUser,
    },
    {
      title: "Management",
      description: "Manage brands and platform integrations",
      icon: Tag,
      color: "text-pink-500",
      path: "/menu/management",
      show: isSuperUser || isSeniorUser,
    },
    {
      title: "Tools",
      description: "Utilities and workflow tools",
      icon: Wrench,
      color: "text-purple-500",
      path: "/menu/tools",
      show: true,
    },
    {
      title: "Error Hunting",
      description: "Find and resolve data issues",
      icon: AlertCircle,
      color: "text-orange-500",
      path: "/menu/error-hunting",
      show: true,
    },
    {
      title: "Administration",
      description: "System administration and user management",
      icon: Users,
      color: "text-slate-500",
      path: "/menu/administration",
      show: isSuperUser || isSeniorUser,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Main Menu</h1>
            <p className="text-sm text-muted-foreground">Select a module to get started</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/profile")}>
              <UserCircle className="h-4 w-4 mr-2" />
              Profile
            </Button>
            <Button variant="outline" onClick={handleSignOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sections.filter(section => section.show).map((section) => (
            <Card
              key={section.title}
              className="cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => navigate(section.path)}
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <section.icon className={`h-8 w-8 ${section.color}`} />
                  <CardTitle>{section.title}</CardTitle>
                </div>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="secondary">
                  Open
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

export default MainMenu;
