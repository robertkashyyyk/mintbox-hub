import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart, Database, Users, Package, RefreshCw, Tag, UserCircle, AlertCircle, AlertTriangle, Wrench } from "lucide-react";
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

  const menuSections = [
    {
      title: "Ordering",
      options: [
        {
          title: "Purchase Order Building",
          description: "Manage inventory, sync data, and track orders",
          icon: ShoppingCart,
          color: "text-blue-500",
          onClick: () => navigate("/dashboard"),
          show: true,
        },
      ],
    },
    {
      title: "SKU Section",
      options: [
        {
          title: "Importing SKUs",
          description: "Import and manage product data",
          icon: Database,
          color: "text-green-500",
          onClick: () => navigate("/importing"),
          show: true,
        },
        {
          title: "View SKU Database",
          description: "Browse and manage your product database",
          icon: Database,
          color: "text-indigo-500",
          onClick: () => navigate("/sku-database"),
          show: true,
        },
      ],
    },
    {
      title: "Stock Updates",
      options: [
        {
          title: "Remote Stock Updates",
          description: "Manage remote stock updates and synchronization",
          icon: RefreshCw,
          color: "text-cyan-500",
          onClick: () => navigate("/remote-stock-updates"),
          show: isSuperUser || isSeniorUser,
        },
      ],
    },
    {
      title: "Management",
      options: [
        {
          title: "Brands",
          description: "Manage brands and product families",
          icon: Tag,
          color: "text-pink-500",
          onClick: () => navigate("/brands"),
          show: isSuperUser || isSeniorUser,
        },
      ],
    },
    {
      title: "Tools",
      options: [
        {
          title: "eBay Clone Creator",
          description: "Create and manage eBay listings",
          icon: Wrench,
          color: "text-purple-500",
          onClick: () => navigate("/ebay-clone"),
          show: true,
        },
      ],
    },
    {
      title: "Error Hunting",
      options: [
        {
          title: "Missing Cost Prices",
          description: "Products without cost prices configured",
          icon: AlertCircle,
          color: "text-orange-500",
          onClick: () => navigate("/missing-cost-prices"),
          show: true,
        },
        {
          title: "Problematic Orders",
          description: "Orders that have not been placed",
          icon: AlertTriangle,
          color: "text-red-500",
          onClick: () => navigate("/problematic-orders"),
          show: true,
        },
      ],
    },
    {
      title: "Administration",
      options: [
        {
          title: "Users",
          description: "Manage users and permissions",
          icon: Users,
          color: "text-slate-500",
          onClick: () => navigate("/user-management"),
          show: isSuperUser || isSeniorUser,
        },
      ],
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
        <div className="space-y-8">
          {menuSections.map((section) => {
            const visibleOptions = section.options.filter((option) => option.show);
            if (visibleOptions.length === 0) return null;

            return (
              <div key={section.title}>
                <h2 className="text-xl font-semibold mb-4 text-foreground/80">{section.title}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {visibleOptions.map((option) => (
                    <Card
                      key={option.title}
                      className="cursor-pointer hover:shadow-lg transition-shadow"
                      onClick={option.onClick}
                    >
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <option.icon className={`h-8 w-8 ${option.color}`} />
                          <CardTitle>{option.title}</CardTitle>
                        </div>
                        <CardDescription>{option.description}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button className="w-full" variant="secondary">
                          Open
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export default MainMenu;
