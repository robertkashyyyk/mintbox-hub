import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, ShoppingCart, FileText, Database, Tag, RefreshCw, Users } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: ShoppingCart,
      title: "Purchase Order Building",
      description: "Smart order recommendations based on stock levels and back orders"
    },
    {
      icon: FileText,
      title: "SKU Importing",
      description: "Import products from CSV with configurable rules to filter unwanted items"
    },
    {
      icon: Database,
      title: "SKU Database",
      description: "Centralized product database with stock levels, pricing, and brand information"
    },
    {
      icon: Tag,
      title: "Brand Management",
      description: "Manage 44+ brands with prefix-based SKU organization and product counts"
    },
    {
      icon: RefreshCw,
      title: "Mintsoft Sync",
      description: "On-demand stock synchronization for specific brands from Mintsoft API"
    },
    {
      icon: Users,
      title: "User Management",
      description: "Role-based access control with Super, Senior, and Simple user tiers"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      <div className="container mx-auto px-4 py-16">
        {/* Hero Section */}
        <div className="text-center space-y-6 max-w-3xl mx-auto mb-16">
          <div className="flex justify-center">
            <div className="p-4 bg-primary/10 rounded-full">
              <Package className="h-16 w-16 text-primary" />
            </div>
          </div>
          <h1 className="text-5xl md:text-6xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60">
            Mintsoft Inventory System
          </h1>
          <p className="text-xl text-muted-foreground">
            Complete inventory management solution with brand-based product organization, 
            automated stock syncing, and intelligent order recommendations
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-6">
            <Button size="lg" onClick={() => navigate("/auth")} className="text-lg px-8">
              Get Started
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/auth")} className="text-lg px-8">
              Sign In
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {features.map((feature, index) => (
            <Card key={index} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Stats Section */}
        <div className="mt-16 max-w-4xl mx-auto">
          <Card className="border-2">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Built for Scale</CardTitle>
              <CardDescription>
                Manage your entire inventory ecosystem in one place
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-8 text-center">
                <div>
                  <div className="text-3xl font-bold text-primary">44+</div>
                  <div className="text-sm text-muted-foreground mt-1">Brands</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-primary">250K+</div>
                  <div className="text-sm text-muted-foreground mt-1">Products</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-primary">Real-time</div>
                  <div className="text-sm text-muted-foreground mt-1">Sync</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Index;
