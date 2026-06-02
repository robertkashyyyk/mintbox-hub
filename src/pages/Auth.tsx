import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Session } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Info, Mail, Sparkles, Loader2 } from "lucide-react";
import brandIcon from "@/assets/brand/partsdoc-icon-teal.png";
import { toast } from "@/hooks/use-toast";

type Mode = "password" | "magic";

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Default landing is the Task Manager (spec §10). NOTE: this must only ship
  // AFTER the tasks migration is applied — otherwise users land on TasksToday,
  // which calls the get_today_tasks RPC that won't yet exist.
  const redirectTo = (location.state as any)?.from || "/tasks";
  const [, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) navigate(redirectTo, { replace: true });
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) navigate(redirectTo, { replace: true });
    });
    return () => subscription.unsubscribe();
  }, [navigate, redirectTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${window.location.origin}/tasks` },
        });
        if (error) throw error;
        toast({
          title: "Check your email",
          description: "We've sent you a magic sign-in link.",
        });
      }
    } catch (err: any) {
      toast({
        title: "Sign in failed",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const options: { id: Mode; label: string; icon: typeof Mail }[] = [
    { id: "password", label: "Email", icon: Mail },
    { id: "magic", label: "Magic Link", icon: Sparkles },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <img
              src={brandIcon}
              alt="PartsDoc"
              className="h-14 w-14 object-contain"
            />
          </div>
          <CardTitle className="text-3xl font-display font-bold text-foreground tracking-tight">PartsDoc Hub</CardTitle>
          <CardDescription className="text-foreground/60">
            Sign in to your account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-foreground/10 bg-foreground/5">
            <Info className="h-4 w-4 text-foreground/70" />
            <AlertDescription className="text-foreground/60">
              This is an invite-only system. Please contact an administrator if you need access.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-2 gap-2">
            {options.map((opt) => {
              const Icon = opt.icon;
              const active = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-md border-2 px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "border-pd-accent bg-pd-accent/10 text-foreground"
                      : "border-input bg-secondary/40 text-foreground/60 hover:text-foreground hover:border-foreground/20",
                  )}
                  aria-pressed={active}
                >
                  <Icon className="h-4 w-4" />
                  {opt.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground/70">Email address</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            {mode === "password" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-foreground/70">Password</Label>
                  <Link
                    to="/reset-password"
                    className="text-xs text-pd-accent hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "password" ? "Sign in" : "Send magic link"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
