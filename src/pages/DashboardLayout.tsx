import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { NotificationBell } from "@/components/dashboard/NotificationBell";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { LogOut, Loader2 } from "lucide-react";

const DashboardLayout = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    // Set up auth state listener FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // Only redirect if we've finished the initial check and there's no session
      if (!isCheckingSession && !session) {
        navigate("/auth", { state: { from: location.pathname } });
      }
    });

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsCheckingSession(false);
      if (!session) {
        navigate("/auth", { state: { from: location.pathname } });
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, location.pathname, isCheckingSession]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast({
      title: "Signed out",
      description: "You have been signed out successfully.",
    });
    navigate("/auth");
  };

  // Show loading state while checking session
  if (isCheckingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Checking session...</p>
        </div>
      </div>
    );
  }

  // Don't render anything if no session (redirect will happen)
  if (!session) {
    return null;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background dark">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          <header className="h-16 border-b border-white/10 bg-[hsl(222,47%,11%)] sticky top-0 z-10">
            <div className="h-full px-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
                <div className="flex items-center gap-3">
                  <div className="h-8 w-1 rounded-full bg-[hsl(174,58%,37%)]" />
                  <div>
                    <h1 className="text-lg font-bold text-white tracking-tight">PartsDoc Hub</h1>
                    <p className="text-xs text-white/50">{session.user.email}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <NotificationBell />
              </div>
            </div>
          </header>

          <main className="flex-1 container mx-auto px-4 py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default DashboardLayout;
