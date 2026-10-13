// RETIRED 2026-10-13 (security/prompt0-fixes): unused debug/test/one-off function that
// was publicly callable with no caller auth. Original source kept for the record at
// supabase/retired/mintsoft-statuses.ts.txt. Neutralised pending deletion: reads no secrets,
// makes no outbound calls.
Deno.serve(() =>
  new Response(JSON.stringify({ error: "gone", message: "This function has been retired." }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
