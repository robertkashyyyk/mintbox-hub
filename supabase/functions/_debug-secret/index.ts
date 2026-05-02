Deno.serve(() => {
  const b64 = Deno.env.get("MINTSOFT_FTP_PRIVATE_KEY_B64") ?? "";
  const raw = Deno.env.get("MINTSOFT_FTP_PRIVATE_KEY") ?? "";
  return new Response(JSON.stringify({
    b64_length: b64.length,
    b64_first20: b64.slice(0, 20),
    b64_last20: b64.slice(-20),
    raw_length: raw.length,
  }), { headers: { "Content-Type": "application/json" }});
});
