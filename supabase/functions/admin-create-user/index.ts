import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { email, password, oldEmail } = await req.json();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const findBy = (e: string) => list?.users?.find((u) => u.email?.toLowerCase() === e.toLowerCase());
    const target = findBy(email);
    const stale = oldEmail ? findBy(oldEmail) : null;
    let result: any = {};
    if (stale && (!target || stale.id !== target?.id)) {
      const { error } = await admin.auth.admin.deleteUser(stale.id);
      result.deletedStale = { id: stale.id, email: stale.email, error: error?.message };
    }
    if (target) {
      const { data, error } = await admin.auth.admin.updateUserById(target.id, { password, email_confirm: true });
      if (error) throw error;
      result.updated = data.user;
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      result.created = data.user;
    }
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
