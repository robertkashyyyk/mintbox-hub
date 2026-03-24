import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Tag, AlertCircle, Activity, FileText, ArrowLeft, Images, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

  const options = [
    {
      title: "Products",
      description: "Browse and manage your product database",
      icon: Database,
      color: "text-indigo-500",
      onClick: () => navigate("/discovery/products"),
      show: true,
    },
    {
      title: "Brands",
      description: "Manage brand information and settings",
      icon: Tag,
      color: "text-pink-500",
      onClick: () => navigate("/discovery/brands"),
      show: true,
    },
    {
      title: "Product Discovery Queue",
      description: "Products discovered from orders that need enrichment",
      icon: AlertCircle,
      color: "text-amber-500",
      onClick: () => navigate("/discovery/discovery-queue"),
      show: true,
    },
    {
      title: "Order Telemetry",
      description: "Diagnostic view of order lines for troubleshooting",
      icon: Activity,
      color: "text-red-500",
      onClick: () => navigate("/discovery/order-telemetry"),
      show: isSuperUser,
    },
    {
      title: "Feed Imports",
      description: "Upload product data and configure import rules",
      icon: FileText,
      color: "text-green-500",
      onClick: () => navigate("/discovery/feed-imports"),
      show: true,
    },
    {
      title: "Bulk Image Upload",
      description: "Upload images in bulk, matched to products by SKU filename",
      icon: Images,
      color: "text-cyan-500",
      onClick: () => navigate("/discovery/bulk-images"),
      show: true,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => navigate("/menu")} className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Main Menu
          </Button>
          <h1 className="text-2xl font-bold">Discovery</h1>
          <p className="text-sm text-muted-foreground">See and manage products, brands, and ingested data.</p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {options.filter(option => option.show).map((option) => (
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
      </main>
    </div>
  );
};

export default DiscoveryIndex;
