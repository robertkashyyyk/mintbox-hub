import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InviteEmailRequest {
  email: string;
  role: string;
  inviteId: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, role, inviteId }: InviteEmailRequest = await req.json();
    
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resend = new Resend(resendApiKey);
    
    const appUrl = Deno.env.get("APP_URL") || "https://mintbox-hub.lovable.app";
    const signupUrl = `${appUrl}/auth`;
    
    console.log(`Sending invitation to ${email} with signup URL: ${signupUrl}`);

    const roleLabels = {
      super_user: "Super User",
      senior_user: "Senior User",
      simple_user: "Simple User",
    } as Record<string, string>;

    const roleLabel = roleLabels[role] || role;

    const emailResponse = await resend.emails.send({
      from: "PartsDoc Hub <noreply@updates.kashyyyk.co.uk>",
      to: [email],
      subject: `You've been invited to PartsDoc Hub`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>You're Invited!</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #4a5568; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f7f9fb;">
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 40px 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <div style="width: 56px; height: 56px; background-color: #279e8a; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
                <span style="color: #ffffff; font-size: 22px; font-weight: 700; line-height: 56px;">PD</span>
              </div>
              <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 600;">PartsDoc Hub</h1>
              <p style="color: #94a3b8; margin: 8px 0 0; font-size: 15px;">You've been invited!</p>
            </div>
            
            <div style="background: #ffffff; padding: 40px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
              <h2 style="color: #0f172a; margin-top: 0; font-size: 22px;">Welcome to PartsDoc Hub</h2>
              
              <p style="font-size: 16px; color: #4a5568;">
                You've been invited to join PartsDoc Hub with <strong style="color: #0f172a;">${roleLabel}</strong> access.
              </p>

              <div style="background: #f0fdf9; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #279e8a;">
                <h3 style="margin-top: 0; color: #0f172a; font-size: 18px;">Your Role: ${roleLabel}</h3>
                <p style="margin: 10px 0 0; color: #4a5568; font-size: 14px;">
                  ${role === "super_user" 
                    ? "Full system access including user management, brand management, and all features."
                    : role === "senior_user"
                    ? "Access to brand management, inventory syncing, and purchase order building."
                    : "Access to purchase order building features."
                  }
                </p>
              </div>

              <div style="text-align: center; margin: 40px 0;">
                <a href="${signupUrl}" 
                   style="background-color: #279e8a; color: #ffffff; padding: 16px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 16px;">
                  Accept Invitation &amp; Sign Up
                </a>
              </div>

              <p style="font-size: 14px; color: #4a5568; margin-top: 30px;">
                <strong style="color: #0f172a;">Important:</strong> Please sign up using this email address (<strong style="color: #0f172a;">${email}</strong>) to receive your assigned role automatically.
              </p>

              <p style="font-size: 14px; color: #64748b; margin-top: 20px;">
                This invitation will expire in 7 days.
              </p>

              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">

              <p style="font-size: 12px; color: #94a3b8; text-align: center;">
                If you didn't expect this invitation, you can safely ignore this email.<br>
                &copy; PartsDoc Hub
              </p>
            </div>
          </body>
        </html>
      `,
    });

    console.log("Invitation email sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailResponse }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error sending invitation email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
