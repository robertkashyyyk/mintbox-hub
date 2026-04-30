import { Auth as SupabaseAuth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Session } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

const Auth = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        navigate("/menu");
      }
    });

    // Set up auth state listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (session) {
        navigate("/menu");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-pd-accent">
              <span className="text-foreground font-bold text-xl">PD</span>
            </div>
          </div>
          <CardTitle className="text-2xl font-bold text-foreground">PartsDoc Hub</CardTitle>
          <CardDescription className="text-foreground/60">
            Sign in to your account or sign up with an invitation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4 border-foreground/10 bg-foreground/5">
            <Info className="h-4 w-4 text-foreground/70" />
            <AlertDescription className="text-foreground/60">
              This is an invite-only system. Please contact an administrator if you need access.
            </AlertDescription>
          </Alert>

          <SupabaseAuth
            supabaseClient={supabase}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: "hsl(174, 58%, 37%)",
                    brandAccent: "hsl(174, 42%, 50%)",
                    inputBackground: "hsla(0, 0%, 100%, 0.05)",
                    inputText: "white",
                    inputBorder: "hsla(0, 0%, 100%, 0.15)",
                    inputLabelText: "hsla(0, 0%, 100%, 0.7)",
                    inputPlaceholder: "hsla(0, 0%, 100%, 0.4)",
                    anchorTextColor: "hsl(174, 58%, 50%)",
                    messageText: "hsla(0, 0%, 100%, 0.7)",
                  },
                },
              },
            }}
            providers={[]}
            redirectTo={`${window.location.origin}/reset-password`}
            onlyThirdPartyProviders={false}
            showLinks={true}
            magicLink={true}
            view="sign_in"
            localization={{
              variables: {
                sign_up: {
                  email_label: "Email address",
                  password_label: "Create a password",
                  button_label: "Sign up",
                  link_text: "Don't have an account? Sign up",
                },
                sign_in: {
                  email_label: "Email address",
                  password_label: "Password",
                  button_label: "Sign in",
                  link_text: "Already have an account? Sign in",
                },
                forgotten_password: {
                  link_text: "Forgot your password?",
                  button_label: "Send reset instructions",
                  confirmation_text: "Check your email for the password reset link",
                },
              },
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
