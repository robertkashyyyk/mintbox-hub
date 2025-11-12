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
    
    // Get the app URL - use the Lovable project URL
    const appUrl = `https://7ef3a60a-b2c3-489a-b7d0-36983268fca0.lovableproject.com`;
    const signupUrl = `${appUrl}/auth`;
    
    console.log(`Sending invitation to ${email} with signup URL: ${signupUrl}`);

    const roleLabels = {
      super_user: "Super User",
      senior_user: "Senior User",
      simple_user: "Simple User",
    } as Record<string, string>;

    const roleLabel = roleLabels[role] || role;

    const emailResponse = await resend.emails.send({
      from: "Mintsoft System <noreply@updates.kashyyyk.co.uk>",
      to: [email],
      subject: `You've been invited to Mintsoft Inventory System`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>You're Invited!</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">You're Invited!</h1>
            </div>
            
            <div style="background: white; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <h2 style="color: #1f2937; margin-top: 0;">Welcome to Mintsoft Inventory System</h2>
              
              <p style="font-size: 16px; color: #4b5563;">
                You've been invited to join the Mintsoft Inventory System with <strong>${roleLabel}</strong> access.
              </p>

              <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 30px 0;">
                <h3 style="margin-top: 0; color: #374151; font-size: 18px;">Your Role: ${roleLabel}</h3>
                <p style="margin: 10px 0; color: #6b7280; font-size: 14px;">
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
                   style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 16px;">
                  Accept Invitation & Sign Up
                </a>
              </div>

              <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
                <strong>Important:</strong> Please sign up using this email address (<strong>${email}</strong>) to receive your assigned role automatically.
              </p>

              <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
                This invitation will expire in 7 days.
              </p>

              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

              <p style="font-size: 12px; color: #9ca3af; text-align: center;">
                If you didn't expect this invitation, you can safely ignore this email.
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
