// ============================================================================
// ebay-account-deletion — Marketplace Account Deletion endpoint (eBay compliance).
// PUBLIC (verify_jwt = false): eBay calls it with no Supabase credentials.
//
//   GET  ?challenge_code=…  → 200 {"challengeResponse": hex(SHA-256(code + token + endpoint))}
//   POST notification       → verify X-EBAY-SIGNATURE, log to ebay.account_deletion_notice,
//                             204. A signature that fails verification gets 412 (not acked).
// We store no buyer data (PII is stripped before storage), so there is nothing to erase;
// the deleted user's IDs are logged only as SHA-256 hashes.
// Secret: EBAY_DELETION_VERIFICATION_TOKEN (the token entered in the eBay portal).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ACCOUNT_DELETION_ENDPOINT, hasSecret, SECRET, secret } from "../_shared/ebay/config.ts";
import { CallLog } from "../_shared/ebay/client.ts";
import { challengeResponse, verifyNotification } from "../_shared/ebay/notification.ts";
import { sha256Hex } from "../_shared/ebay/state.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const code = url.searchParams.get("challenge_code");
    if (!code || code.length > 512) return json({ error: "challenge_code required" }, 400);
    if (!hasSecret(SECRET.deletionToken)) return json({ error: "not configured" }, 503);
    return json({
      challengeResponse: await challengeResponse(code, secret(SECRET.deletionToken), ACCOUNT_DELETION_ENDPOINT),
    });
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const raw = await req.text();
  if (raw.length > 64_000) return json({ error: "too large" }, 413);
  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid JSON" }, 400); }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const log = new CallLog(supa, "ebay-account-deletion");

  // Verify the signature. If our app credentials aren't set yet we can't fetch eBay's key:
  // acknowledge (so eBay doesn't flag us) and record it as unverified.
  let valid: boolean | null = null;
  let sigError: string | null = null;
  if (hasSecret(SECRET.appId) && hasSecret(SECRET.certId)) {
    try { valid = await verifyNotification(raw, req.headers.get("x-ebay-signature"), log); }
    catch (e) { valid = null; sigError = `could not verify: ${(e as Error).message}`; }
  } else {
    sigError = "app credentials not configured; signature not checked";
  }
  if (valid === false) sigError = "signature invalid";

  const n = body?.notification ?? {};
  const d = n?.data ?? {};
  try {
    await supa.rpc("ebay_log_deletion_notice", {
      p_notification_id: String(n.notificationId ?? `missing-${crypto.randomUUID()}`),
      p_topic: body?.metadata?.topic ?? null,
      p_publish_date: n.publishDate ?? null,
      p_event_date: n.eventDate ?? null,
      p_signature_valid: valid,
      p_signature_error: sigError,
      p_user_id_sha256: d.userId ? await sha256Hex(String(d.userId)) : null,
      p_username_sha256: d.username ? await sha256Hex(String(d.username)) : null,
    });
  } catch (e) {
    console.error(`[ebay-account-deletion] log failed: ${(e as Error).message}`);
  }
  await log.flush();

  if (valid === false) return json({ error: "signature verification failed" }, 412);
  return new Response(null, { status: 204 });
});
