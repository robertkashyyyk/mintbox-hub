import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { email, password, secret } = await req.json();
    if (secret !== Deno.env.get("CRON_SECRET")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Try to find existing
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list?.users?.find((u) => u.email?.toLowerCase() === String(email).toLowerCase());
    let result;
    if (existing) {
      const { data, error } = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
      if (error) throw error;
      result = { updated: true, user: data.user };
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      result = { created: true, user: data.user };
    }
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
