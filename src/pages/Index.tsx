import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Package } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-6 max-w-2xl px-4">
        <div className="flex justify-center">
          <div className="p-4 bg-primary/10 rounded-full">
            <Package className="h-16 w-16 text-primary" />
          </div>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold">Mintsoft Order Dashboard</h1>
        <p className="text-xl text-muted-foreground">
          Streamline your parts ordering process with automated report management
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <Button size="lg" onClick={() => navigate("/auth")}>
            Get Started
          </Button>
          <Button size="lg" variant="outline" onClick={() => navigate("/auth")}>
            Sign In
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Index;
