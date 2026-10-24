// deno test --allow-env supabase/functions/_shared/ebay/ebay_test.ts
// Offline tests for the shared eBay client: nothing here talks to eBay.
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { generateKeyPairSync, createSign, createHash } from "node:crypto";
import { assertAllowed, EbayWriteBlockedError } from "./allowlist.ts";
import { CallLog, ebayFetch } from "./client.ts";
import { contentDigest, signatureBase, signedHeaders } from "./signing.ts";
import { BadStateError, makeState, readState } from "./state.ts";
import { challengeResponse, toPem, verifyWithPem } from "./notification.ts";
import { shape, stripPii } from "./pii.ts";

const API = "https://api.ebay.com", APIZ = "https://apiz.ebay.com";

// ---------------------------------------------------------------- read-only enforcement
Deno.test("allowlist: campaign updates and offer/listing writes are blocked", () => {
  const writes: Array<[string, string, unknown?]> = [
    ["POST", `${API}/sell/marketing/v1/ad_campaign/123/pause`],
    ["POST", `${API}/sell/marketing/v1/ad_campaign/123/update_campaign_identification`, { campaignName: "x" }],
    ["POST", `${API}/sell/marketing/v1/ad_campaign`, { campaignName: "new" }],
    ["PUT", `${API}/sell/marketing/v1/ad_campaign/123/update_bid`],
    ["DELETE", `${API}/sell/marketing/v1/ad_campaign/123`],
    ["DELETE", `${API}/sell/marketing/v1/ad_report_task/abc`],
    ["PUT", `${API}/sell/inventory/v1/offer/123`, { pricingSummary: { price: { value: "1.00" } } }],
    ["POST", `${API}/sell/inventory/v1/offer/123/publish`],
    ["POST", `${API}/sell/inventory/v1/bulk_update_price_quantity`, { requests: [] }],
    ["POST", `${API}/sell/fulfillment/v1/order/12-345/issue_refund`],
    ["POST", `${API}/sell/account/v1/payment_policy`],
    ["POST", `${API}/sell/feed/v1/task`, { feedType: "LMS_ADD_FIXED_PRICE_ITEM" }],
    ["POST", `${API}/sell/feed/v1/inventory_task`, { feedType: "LMS_REVISE_INVENTORY_STATUS" }],
    ["POST", `${API}/ws/api.dll`],
    ["GET", `${API}/sell/finances/v1/transaction`],                         // wrong host (Finances is apiz)
    ["GET", `http://apiz.ebay.com/sell/finances/v1/transaction`],          // not https
    ["GET", `${APIZ}/sell/finances/v1/../../inventory/v1/offer`],          // traversal normalises away
    ["GET", `https://evil.example.com/sell/finances/v1/transaction`],
  ];
  for (const [m, u, b] of writes) {
    assertThrows(() => assertAllowed(m, u, b), EbayWriteBlockedError, undefined, `${m} ${u} should be blocked`);
  }
});

Deno.test("allowlist: the reads and report-task POSTs we need are allowed", () => {
  const reads: Array<[string, string, unknown?]> = [
    ["GET", `${APIZ}/sell/finances/v1/transaction?filter=transactionDate:[a..b]&limit=1000`],
    ["GET", `${APIZ}/sell/finances/v1/payout/123`],
    ["GET", `${APIZ}/sell/finances/v1/billing_activity`],
    ["GET", `${API}/sell/fulfillment/v1/order?limit=50`],
    ["GET", `${API}/sell/fulfillment/v1/order/12-34567-89012`],
    ["GET", `${API}/sell/analytics/v1/seller_standards_profile`],
    ["GET", `${API}/sell/analytics/v1/seller_standards_profile/PROGRAM_UK/CURRENT`],
    ["GET", `${API}/sell/analytics/v1/customer_service_metric/ITEM_NOT_AS_DESCRIBED/CURRENT`],
    ["GET", `${API}/sell/analytics/v1/traffic_report?dimension=DAY`],
    ["GET", `${API}/sell/marketing/v1/ad_campaign?limit=5`],
    ["GET", `${API}/sell/marketing/v1/ad_report/abc`],
    ["POST", `${API}/sell/marketing/v1/ad_report_task`, { reportType: "LISTING_PERFORMANCE_REPORT" }],
    ["GET", `${API}/sell/feed/v1/inventory_task?feed_type=LMS_ACTIVE_INVENTORY_REPORT`],
    ["POST", `${API}/sell/feed/v1/inventory_task`, { feedType: "LMS_ACTIVE_INVENTORY_REPORT", schemaVersion: "1.0" }],
    ["GET", `${API}/sell/feed/v1/task/task-1/download_result_file`],
    ["GET", `${API}/sell/account/v1/privilege`],
    ["GET", `${APIZ}/commerce/identity/v1/user/`],
    ["GET", `${API}/commerce/notification/v1/public_key/abc-123`],
    ["POST", `${APIZ}/developer/key_management/v1/signing_key`, { signingKeyCipher: "ED25519" }],
  ];
  for (const [m, u, b] of reads) assertAllowed(m, u, b);
});

Deno.test("ebayFetch: a blocked write never reaches the network and is logged", async () => {
  let fetched = 0;
  const log = new CallLog(null, "test");
  await assertRejects(() => ebayFetch({
    method: "POST", url: `${API}/sell/marketing/v1/ad_campaign/999/pause`, body: {}, token: "t", log,
    fetchImpl: () => { fetched++; return Promise.resolve(new Response("{}")); },
  }), EbayWriteBlockedError);
  assertEquals(fetched, 0);
  assertEquals(log.rows.length, 1);
  assert(log.rows[0].blocked);
});

Deno.test("ebayFetch: retries 429 then returns, with marketplace header", async () => {
  let n = 0;
  const seen: Headers[] = [];
  const log = new CallLog(null, "test");
  const res = await ebayFetch({
    url: `${API}/sell/fulfillment/v1/order`, token: "t", log,
    fetchImpl: (_u, init) => {
      seen.push(new Headers(init?.headers));
      n++;
      return Promise.resolve(n === 1 ? new Response("slow down", { status: 429, headers: { "Retry-After": "0" } })
                                     : new Response(JSON.stringify({ orders: [] }), { status: 200 }));
    },
  });
  assertEquals(res.status, 200);
  assertEquals(n, 2);
  assertEquals(seen[0].get("X-EBAY-C-MARKETPLACE-ID"), "EBAY_GB");
  assertEquals(log.rows.map((r) => r.status), [429, 200]);
});

// ---------------------------------------------------------------- signatures
Deno.test("signing: Content-Digest matches eBay's documented example", async () => {
  assertEquals(await contentDigest('{"hello": "world"}'), "sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:");
});

Deno.test("signing: signature base is byte-for-byte eBay's SDK format", () => {
  const { base, input } = signatureBase({ jwe: "JWE", method: "get", path: "/sell/finances/v1/transaction", authority: "apiz.ebay.com" }, 1658440308);
  assertEquals(base,
    '"x-ebay-signature-key": JWE\n"@method": GET\n"@path": /sell/finances/v1/transaction\n"@authority": apiz.ebay.com\n' +
    '"@signature-params": ("x-ebay-signature-key" "@method" "@path" "@authority");created=1658440308');
  assertEquals(input, 'sig1=("x-ebay-signature-key" "@method" "@path" "@authority");created=1658440308');
  const withBody = signatureBase({ jwe: "J", method: "POST", path: "/p", authority: "h", contentDigest: "sha-256=:d:" }, 1);
  assert(withBody.base.startsWith('"content-digest": sha-256=:d:\n"x-ebay-signature-key": J\n'));
  assertEquals(withBody.input, 'sig1=("content-digest" "x-ebay-signature-key" "@method" "@path" "@authority");created=1');
});

Deno.test("signing: Ed25519 signature verifies with the public key (PEM and bare base64 keys)", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const bare = (privateKey.export({ type: "pkcs8", format: "der" }) as Uint8Array);
  const bareB64 = btoa(String.fromCharCode(...bare));
  const pubDer = new Uint8Array(publicKey.export({ type: "spki", format: "der" }) as Uint8Array);
  const pub = await crypto.subtle.importKey("spki", pubDer, { name: "Ed25519" }, false, ["verify"]);
  for (const pk of [pem, bareB64]) {
    const url = `${APIZ}/sell/finances/v1/transaction?limit=5`;
    const h = await signedHeaders({ privateKey: pk, jwe: "JWE" }, "GET", url, undefined, 1700000000);
    assertEquals(h["x-ebay-signature-key"], "JWE");
    assertEquals(h["Content-Digest"], undefined);
    const sig = h.Signature.match(/^sig1=:(.+):$/)![1];
    const { base } = signatureBase({ jwe: "JWE", method: "GET", path: "/sell/finances/v1/transaction", authority: "apiz.ebay.com" }, 1700000000);
    const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
    assert(await crypto.subtle.verify({ name: "Ed25519" }, pub, sigBytes, new TextEncoder().encode(base)));
  }
});

// ---------------------------------------------------------------- OAuth state
Deno.test("state: round-trips, and rejects tampering, wrong key and expiry", async () => {
  const k = "k".repeat(64);
  const { state, nonceSha256 } = await makeState("ASC", 20, k);
  const p = await readState(state, k);
  assertEquals(p.account, "ASC");
  assertEquals(nonceSha256.length, 64);
  const [payload, sig] = state.split(".");
  const forged = btoa(JSON.stringify({ a: "CPI", n: p.nonce, e: p.expiresAt })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  await assertRejects(() => readState(`${forged}.${sig}`, k), BadStateError);
  await assertRejects(() => readState(`${payload}.${sig}x`, k), BadStateError);
  await assertRejects(() => readState(state, "other-key".repeat(8)), BadStateError);
  await assertRejects(() => readState("", k), BadStateError);
  const old = await makeState("ASC", -1, k);
  await assertRejects(() => readState(old.state, k), BadStateError, "expired");
});

// ---------------------------------------------------------------- account deletion
Deno.test("deletion: challenge response is hex SHA-256(code + token + endpoint)", async () => {
  const want = createHash("sha256").update("abc").update("tok_123").update("https://x/functions/v1/ebay-account-deletion").digest("hex");
  assertEquals(await challengeResponse("abc", "tok_123", "https://x/functions/v1/ebay-account-deletion"), want);
});

Deno.test("deletion: notification signature check (ECDSA, SHA-1 as eBay's SDK; one-line PEM)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const oneLine = (publicKey.export({ type: "spki", format: "pem" }) as string).replace(/\n/g, "");
  const msg = JSON.stringify({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: { notificationId: "n1" } });
  const signer = createSign("sha1"); signer.update(msg);
  const signature = signer.sign(privateKey, "base64");
  assert(verifyWithPem(msg, { kid: "k", signature, digest: "SHA1" }, toPem(oneLine)));
  assert(!verifyWithPem(msg + " ", { kid: "k", signature, digest: "SHA1" }, toPem(oneLine)));
});

// ---------------------------------------------------------------- PII
Deno.test("pii: buyer details are redacted in stored copies and shapes", () => {
  const order = { orderId: "1", buyer: { username: "jo" }, fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "Jo" } } }], lineItems: [{ sku: "A", total: 1 }] };
  const s = stripPii(order) as any;
  assertEquals(s.buyer, "[redacted]");
  assertEquals(s.fulfillmentStartInstructions[0].shippingStep.shipTo, "[redacted]");
  assertEquals(s.lineItems[0].sku, "A");
  assertEquals((shape(order) as any).lineItems[0], { sku: "string", total: "number" });
});
