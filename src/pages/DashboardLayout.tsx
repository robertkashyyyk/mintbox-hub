import { useEffect, useRef, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { NotificationBell } from "@/components/dashboard/NotificationBell";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { LogOut, Loader2, ExternalLink, WrenchIcon, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import brandIcon from "@/assets/brand/partsdoc-icon-teal.png";

const IDLE_TIMEOUT_MS        = 60 * 60 * 1000;      // 1 hour  — regular users: force sign-out
const SUPER_IDLE_WARN_MS     = 2 * 60 * 60 * 1000;  // 2 hours — super users: show warning banner
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;            // check every minute

const DashboardLayout = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSuperUser, setIsSuperUser] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const lastActivityRef = useRef<number>(Date.now());

  // ── Idle timeout ─────────────────────────────────────────────────
  useEffect(() => {
    const resetActivity = () => {
      lastActivityRef.current = Date.now();
      setShowIdleWarning(false); // dismiss warning on any activity
    };
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;
    events.forEach(e => window.addEventListener(e, resetActivity, { passive: true }));

    const idleTimer = setInterval(async () => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (isSuperUser) {
        // Super users: show a soft warning after 2 hours, never force sign-out
        if (idleMs >= SUPER_IDLE_WARN_MS) setShowIdleWarning(true);
      } else {
        // Regular users: force sign-out after 1 hour
        if (idleMs >= IDLE_TIMEOUT_MS) {
          clearInterval(idleTimer);
          await supabase.auth.signOut();
          toast({
            title: "Signed out due to inactivity",
            description: "You were inactive for over an hour. Please sign in again.",
          });
          navigate("/auth");
        }
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity));
      clearInterval(idleTimer);
    };
  }, [isSuperUser, navigate, toast]);

  // ── Auth state ───────────────────────────────────────────────────
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!isCheckingSession && !session) {
        navigate("/auth", { state: { from: location.pathname } });
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsCheckingSession(false);
      if (!session) {
        navigate("/auth", { state: { from: location.pathname } });
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, location.pathname, isCheckingSession]);

  // ── Fetch current user's role ─────────────────────────────────────
  useEffect(() => {
    if (!session?.user?.id) return;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .then(({ data }) => {
        setIsSuperUser(data?.some(r => r.role === "super_user") ?? false);
      });
  }, [session?.user?.id]);

  // ── Maintenance mode: realtime subscription ───────────────────────
  useEffect(() => {
    // Initial fetch
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "maintenance_mode")
      .single()
      .then(({ data }) => {
        setMaintenanceMode(data?.value === true);
      });

    // Subscribe to changes
    const channel = supabase
      .channel("maintenance-mode-dashboard")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "app_settings", filter: "key=eq.maintenance_mode" },
        async (payload) => {
          const isOn = payload.new.value === true;
          setMaintenanceMode(isOn);
          if (isOn && !isSuperUser) {
            // Small delay so the DB write settles and isSuperUser state is accurate
            await supabase.auth.signOut();
            toast({
              title: "System maintenance",
              description: "The system has been taken offline for maintenance. Please try again later.",
            });
            navigate("/auth");
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperUser, navigate, toast]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast({
      title: "Signed out",
      description: "You have been signed out successfully.",
    });
    navigate("/auth");
  };

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

  if (!session) {
    return null;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background dark">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Idle warning banner — super_users only, after 2 hours of inactivity */}
          {showIdleWarning && isSuperUser && !maintenanceMode && (
            <div className="bg-blue-500/10 border-b border-blue-500/20 px-4 py-2 flex items-center justify-between gap-4 text-sm text-blue-400">
              <span>
                <strong>You've been idle for over 2 hours.</strong> We recommend signing out and back in to ensure your session is fresh.
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-blue-500/40 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300"
                  onClick={handleSignOut}
                >
                  Sign out &amp; back in
                </Button>
                <button
                  onClick={() => setShowIdleWarning(false)}
                  className="text-blue-400/60 hover:text-blue-400 text-xs underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Maintenance mode banner — super_users stay in but are warned */}
          {maintenanceMode && isSuperUser && (
            <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between gap-4 text-sm text-amber-400">
              <div className="flex items-center gap-2">
                <WrenchIcon className="h-4 w-4 flex-shrink-0" />
                <span>
                  <strong>Maintenance mode is active.</strong> All non-admin users have been signed out.
                  Updates or changes may be in progress — you should also sign out until work is complete.
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="flex-shrink-0 border-amber-500/40 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300"
                onClick={handleSignOut}
              >
                Sign out now
              </Button>
            </div>
          )}

          <header className="h-16 border-b border-foreground/10 bg-background sticky top-0 z-10">
            <div className="h-full px-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <SidebarTrigger className="text-pd-accent hover:text-pd-accent-light" />
                <div className="flex items-center gap-3">
                  <img src={brandIcon} alt="PartsDoc" className="h-8 w-8 object-contain" />
                  <div>
                    <h1 className="text-lg font-display font-bold text-foreground tracking-tight">PartsDoc Hub</h1>
                    <p className="text-xs text-foreground/50">{session.user.email}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  asChild
                  className="text-muted-foreground hover:text-foreground"
                  title="Progress Log"
                >
                  <Link to="/progress-log">
                    <ClipboardList className="h-5 w-5" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  asChild
                  className="text-pd-accent hover:text-pd-accent-light"
                  title="Brand Site"
                >
                  <a href="https://brand.partsdochub.com" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-5 w-5" />
                  </a>
                </Button>
                <NotificationBell />
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-8 max-w-full overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default DashboardLayout;
