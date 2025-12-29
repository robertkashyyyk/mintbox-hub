import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Activity, RefreshCw, Gauge } from "lucide-react";

const OperationsIndex = () => {
  const navigate = useNavigate();

  const options = [
    {
      title: "Order Monitoring",
      description: "Track order status snapshots and daily progress",
      icon: Activity,
      color: "text-amber-500",
      onClick: () => navigate("/operations/order-monitoring"),
    },
    {
      title: "Sync Status",
      description: "Monitor data synchronization across systems",
      icon: RefreshCw,
      color: "text-blue-500",
      onClick: () => navigate("/operations/sync-status"),
    },
    {
      title: "System Health",
      description: "View system performance and diagnostics",
      icon: Gauge,
      color: "text-green-500",
      onClick: () => navigate("/operations/system-health"),
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/menu")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Operations</h1>
              <p className="text-sm text-muted-foreground">Order monitoring, sync status, and system health</p>
            </div>
          </div>
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

export default OperationsIndex;
