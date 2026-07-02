// TEMPORARY debug helper — echoes the 3D-reprice SFTP connection settings so we
// can fill in 3D Sellers' "Import via FTP/SFTP" form. Returns host/port/user and
// only the LENGTH of the password (never the value). Service-role gated. DELETE
// after use.
Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let ok = bearer === serviceKey;
  if (!ok && bearer) {
    try { ok = JSON.parse(atob(bearer.split(".")[1] ?? ""))?.role === "service_role"; } catch { /* ignore */ }
  }
  if (!ok) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const pw = Deno.env.get("THREEDS_SFTP_PASSWORD") ?? "";
  return new Response(JSON.stringify({
    host: Deno.env.get("THREEDS_SFTP_HOST") ?? null,
    port: Deno.env.get("THREEDS_SFTP_PORT") ?? "(unset → defaults to 22)",
    username: Deno.env.get("THREEDS_SFTP_USER") ?? null,
    password_set: pw.length > 0,
    password_length: pw.length,
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
