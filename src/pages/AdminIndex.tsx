import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Key, CreditCard, FileText, ArrowLeft, Settings, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";

const AdminIndex = () => {
  const navigate = useNavigate();

  const options = [
    {
      title: "User Management",
      description: "Manage users, roles, and invitations",
      icon: Users,
      color: "text-blue-500",
      onClick: () => navigate("/admin/users"),
    },
    {
      title: "API Access",
      description: "Manage API keys and integrations",
      icon: Key,
      color: "text-green-500",
      onClick: () => navigate("/admin/api-keys"),
    },
    {
      title: "Billing & Usage",
      description: "View Xask usage and billing information",
      icon: CreditCard,
      color: "text-purple-500",
      onClick: () => navigate("/admin/billing"),
    },
    {
      title: "Logs / Diagnostics",
      description: "System logs and diagnostic information",
      icon: FileText,
      color: "text-slate-500",
      onClick: () => navigate("/admin/logs"),
    },
    {
      title: "System Settings",
      description: "Application-wide configuration and feature flags",
      icon: Settings,
      color: "text-orange-500",
      onClick: () => navigate("/admin/settings"),
    },
    {
      title: "Integrations",
      description: "Manage connections to external services",
      icon: Plug,
      color: "text-cyan-500",
      onClick: () => navigate("/admin/integrations"),
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
          <p className="text-sm text-muted-foreground">User management, API keys and billing.</p>
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

export default AdminIndex;
