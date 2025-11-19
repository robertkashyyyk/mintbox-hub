import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const ToolsSection = () => {
  const navigate = useNavigate();

  const options = [
    {
      title: "eBay Clone Creator",
      description: "Create and manage eBay listings",
      icon: Wrench,
      color: "text-purple-500",
      onClick: () => navigate("/ebay-clone"),
    },
    {
      title: "Price Hunter",
      description: "eBay price checks and queue management",
      icon: Wrench,
      color: "text-green-500",
      onClick: () => navigate("/price-hunter"),
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
          <h1 className="text-2xl font-bold">Tools</h1>
          <p className="text-sm text-muted-foreground">Utilities and workflow tools</p>
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

export default ToolsSection;
