import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const AdministrationSection = () => {
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

  if (!isSuperUser && !isSeniorUser) {
    navigate("/menu");
    return null;
  }

  const options = [
    {
      title: "Users",
      description: "Manage users and permissions",
      icon: Users,
      color: "text-slate-500",
      onClick: () => navigate("/user-management"),
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
          <h1 className="text-2xl font-bold">Administration</h1>
          <p className="text-sm text-muted-foreground">System administration and user management</p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {options.map((option) => (
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

export default AdministrationSection;
