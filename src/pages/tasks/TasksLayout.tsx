/**
 * Full Task Environment layout (spec §3.2). A distinct visual mode — deep teal
 * background, the main Hub sidebar replaced by a slim task-specific sidebar — to
 * signal a focused working context. Renders outside DashboardLayout, so it does
 * its own auth gating.
 */
import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation, NavLink, Link } from "react-router-dom";
import { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CalendarCheck,
  ListChecks,
  Users,
  Plus,
  ArrowLeft,
  Loader2,
  ClipboardList,
} from "lucide-react";

const navItems = [
  { to: "/tasks", label: "Today", icon: CalendarCheck, end: true },
  { to: "/tasks/my", label: "My Tasks", icon: ListChecks, end: false },
  { to: "/tasks/all", label: "All Tasks", icon: Users, end: false, superOnly: true },
  { to: "/audit", label: "Audit Log", icon: ClipboardList, end: false, superOnly: true },
];

const TasksLayout = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [isSuperUser, setIsSuperUser] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setChecking(false);
      if (!session) navigate("/auth", { state: { from: location.pathname } });
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) navigate("/auth", { state: { from: location.pathname } });
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .then(({ data }) => setIsSuperUser(data?.some((r) => r.role === "super_user") ?? false));
  }, [session?.user?.id]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[hsl(185,60%,9%)]">
        <Loader2 className="h-8 w-8 animate-spin text-teal-300" />
      </div>
    );
  }
  if (!session) return null;

  return (
    <div className="dark flex min-h-screen w-full bg-[hsl(185,60%,9%)] text-foreground">
      {/* Slim task-specific sidebar */}
      <aside className="flex w-56 flex-shrink-0 flex-col border-r border-teal-400/15 bg-[hsl(185,55%,12%)]">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/20">
            <CalendarCheck className="h-4 w-4 text-teal-300" />
          </div>
          <div>
            <p className="text-sm font-semibold text-teal-50">Tasks</p>
            <p className="text-[10px] text-teal-200/50">Focus mode</p>
          </div>
        </div>

        <div className="px-3">
          <Button asChild className="w-full bg-teal-500 text-teal-950 hover:bg-teal-400">
            <Link to="/tasks/new">
              <Plus className="mr-1.5 h-4 w-4" /> New Task
            </Link>
          </Button>
        </div>

        <nav className="mt-4 flex-1 space-y-1 px-3">
          {navItems
            .filter((item) => !item.superOnly || isSuperUser)
            .map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-teal-500/20 text-teal-100"
                      : "text-teal-200/60 hover:bg-teal-500/10 hover:text-teal-100",
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
        </nav>

        <div className="border-t border-teal-400/15 p-3">
          <Button
            asChild
            variant="ghost"
            className="w-full justify-start text-teal-200/60 hover:bg-teal-500/10 hover:text-teal-100"
          >
            <Link to="/menu">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Hub
            </Link>
          </Button>
          <p className="mt-2 px-3 text-[10px] text-teal-200/40">{session.user.email}</p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
};

export default TasksLayout;
