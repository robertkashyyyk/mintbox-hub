import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { DownloadHistory } from "@/components/dashboard/DownloadHistory";
import { OrderTracking } from "@/components/dashboard/OrderTracking";
import { NotificationBell } from "@/components/dashboard/NotificationBell";
import { SyncControl } from "@/components/dashboard/SyncControl";
import { SyncHistory } from "@/components/dashboard/SyncHistory";
import { LogOut } from "lucide-react";

const Dashboard = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) {
        navigate("/auth");
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast({
      title: "Signed out",
      description: "You have been signed out successfully.",
    });
    navigate("/auth");
  };

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Mintsoft Dashboard</h1>
            <p className="text-sm text-muted-foreground">{session.user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Button variant="outline" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        <SyncControl />

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          <SyncHistory />
          <DownloadHistory />
          <OrderTracking selectedBrand={selectedBrand} userId={session.user.id} />
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
