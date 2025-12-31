import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Subscriber {
  id: string;
  name: string;
  email: string;
  enabled: boolean;
}

interface WeeklySummary {
  week_start: string;
  week_end: string;
  current_total: number;
  current_rotten: number;
  current_serious: number;
  current_urgent: number;
  week_start_total: number;
  net_change: number;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("send-ops-weekly-report: Starting execution");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if this is a test run
    let isTest = false;
    try {
      const body = await req.json();
      isTest = body?.test === true;
    } catch {
      // No body or invalid JSON - not a test
    }

    console.log(`send-ops-weekly-report: isTest=${isTest}`);

    // Get enabled subscribers
    const { data: subscribers, error: subError } = await supabase
      .from("ops_report_subscribers")
      .select("*")
      .eq("enabled", true);

    if (subError) {
      console.error("send-ops-weekly-report: Error fetching subscribers", subError);
      throw new Error(`Failed to fetch subscribers: ${subError.message}`);
    }

    if (!subscribers || subscribers.length === 0) {
      console.log("send-ops-weekly-report: No enabled subscribers found");
      return new Response(
        JSON.stringify({ message: "No enabled subscribers" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`send-ops-weekly-report: Found ${subscribers.length} subscribers`);

    // Get weekly summary data
    const { data: weeklySummary, error: weeklyError } = await supabase
      .from("ops_backorder_weekly_summary")
      .select("*")
      .maybeSingle();

    if (weeklyError) {
      console.error("send-ops-weekly-report: Error fetching weekly summary", weeklyError);
    }

    // Get today's order flow for avg picking pressure
    const { data: orderFlow, error: orderError } = await supabase
      .from("order_status_snapshot_today")
      .select("pm_awaitingpicking")
      .maybeSingle();

    if (orderError) {
      console.error("send-ops-weekly-report: Error fetching order flow", orderError);
    }

    // Calculate Friday date (current week or most recent)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
    const fridayDate = new Date(now);
    if (daysUntilFriday > 0) {
      fridayDate.setDate(fridayDate.getDate() - (7 - daysUntilFriday));
    }
    const weekEndingStr = fridayDate.toISOString().split("T")[0];

    // Format the email content
    const formatDelta = (delta: number) => {
      if (delta > 0) return `<span style="color: #dc2626;">↑ +${delta}</span>`;
      if (delta < 0) return `<span style="color: #16a34a;">↓ ${delta}</span>`;
      return `<span style="color: #6b7280;">→ 0</span>`;
    };

    const summary = weeklySummary as WeeklySummary | null;
    const pmPicking = orderFlow?.pm_awaitingpicking ?? "N/A";

    const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
        .header { background: #1e293b; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .metric { background: #f8fafc; border-radius: 8px; padding: 15px; margin: 10px 0; }
        .metric-label { color: #64748b; font-size: 14px; }
        .metric-value { font-size: 24px; font-weight: bold; color: #1e293b; }
        .section-title { font-size: 18px; font-weight: bold; margin: 20px 0 10px 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e2e8f0; }
        th { background: #f1f5f9; }
        .footer { background: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b; }
        .rotten { color: #dc2626; }
        .serious { color: #ea580c; }
        .urgent { color: #d97706; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1 style="margin: 0;">Ops Update</h1>
        <p style="margin: 5px 0 0 0;">Week Ending ${new Date(weekEndingStr).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
      </div>
      
      <div class="content">
        ${summary ? `
        <div class="section-title">Backorder Summary</div>
        
        <div class="metric">
          <div class="metric-label">Total Backorders</div>
          <div class="metric-value">${summary.current_total} ${formatDelta(summary.net_change)}</div>
          <div class="metric-label">vs start of week (${summary.week_start_total})</div>
        </div>

        <table>
          <tr>
            <th>Category</th>
            <th>Count</th>
          </tr>
          <tr>
            <td><span class="rotten">● ROTTEN (30+ days)</span></td>
            <td><strong>${summary.current_rotten}</strong></td>
          </tr>
          <tr>
            <td><span class="serious">● SERIOUS (14-29 days)</span></td>
            <td><strong>${summary.current_serious}</strong></td>
          </tr>
          <tr>
            <td><span class="urgent">● URGENT (7-13 days)</span></td>
            <td><strong>${summary.current_urgent}</strong></td>
          </tr>
        </table>

        <div class="section-title">Operational Pressure</div>
        
        <div class="metric">
          <div class="metric-label">Average PM Awaiting Picking</div>
          <div class="metric-value">${pmPicking}</div>
          <div class="metric-label">End-of-day picking queue depth</div>
        </div>
        ` : `
        <div class="metric">
          <div class="metric-label">Note</div>
          <div class="metric-value">Insufficient data for weekly summary</div>
        </div>
        `}

        <div class="section-title">Focus for Next Week</div>
        <p>Review ROTTEN and SERIOUS backorders. Prioritise clearing legacy orders to prevent further ageing.</p>
      </div>
      
      <div class="footer">
        This is an automated report from Operations Dashboard.
        ${isTest ? "<br><strong>⚠️ This is a TEST report</strong>" : ""}
      </div>
    </body>
    </html>
    `;

    // Send emails to all subscribers
    const recipientEmails = (subscribers as Subscriber[]).map((s) => s.email);
    
    console.log(`send-ops-weekly-report: Sending to ${recipientEmails.length} recipients`);

    const emailResponse = await resend.emails.send({
      from: "Operations <onboarding@resend.dev>",
      to: recipientEmails,
      subject: `Ops Update – Week Ending ${new Date(weekEndingStr).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}${isTest ? " [TEST]" : ""}`,
      html: emailHtml,
    });

    console.log("send-ops-weekly-report: Email sent", emailResponse);

    // Log the send
    const { error: logError } = await supabase
      .from("ops_report_log")
      .insert({
        report_type: "weekly",
        recipients_count: recipientEmails.length,
        status: "success",
        week_ending: weekEndingStr,
      });

    if (logError) {
      console.error("send-ops-weekly-report: Error logging send", logError);
    }

    return new Response(
      JSON.stringify({ success: true, recipients: recipientEmails.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("send-ops-weekly-report: Error", error);

    // Try to log the failure
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      await supabase.from("ops_report_log").insert({
        report_type: "weekly",
        recipients_count: 0,
        status: "error",
        error_message: error.message,
      });
    } catch {
      console.error("send-ops-weekly-report: Failed to log error");
    }

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);