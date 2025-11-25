import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart, DollarSign, RefreshCw, Copy, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const ExecutionIndex = () => {
  const navigate = useNavigate();

  const options = [
    {
      title: "Purchase Order Builder",
      description: "Create and manage purchase orders for suppliers",
      icon: ShoppingCart,
      color: "text-blue-500",
      onClick: () => navigate("/execution/purchase-orders"),
    },
    {
      title: "Price Push",
      description: "eBay price checks and automated pricing updates",
      icon: DollarSign,
      color: "text-green-500",
      onClick: () => navigate("/execution/price-push"),
    },
    {
      title: "Remote Stock Updates",
      description: "Configure and manage remote stock feed types",
      icon: RefreshCw,
      color: "text-cyan-500",
      onClick: () => navigate("/execution/remote-stock-updates"),
    },
    {
      title: "Listing Cloner",
      description: "Create and manage eBay listings from templates",
      icon: Copy,
      color: "text-purple-500",
      onClick: () => navigate("/execution/listing-cloner"),
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
          <h1 className="text-2xl font-bold">Execution</h1>
          <p className="text-sm text-muted-foreground">Execute purchase, pricing and listing actions.</p>
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

export default ExecutionIndex;
