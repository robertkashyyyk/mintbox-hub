// ============================================================================
// _shared/ebay/pii.ts — strip buyer personal data before anything is stored or shown.
// Finances and Fulfillment payloads carry buyer usernames, names, addresses, phones and
// emails. Nothing eBay-buyer-identifying is persisted (Marketplace Account Deletion).
// ============================================================================

const PII_KEYS = new Set([
  "buyer", "buyerUsername", "username", "shipTo", "contactAddress", "primaryPhone", "phoneNumber",
  "email", "emailAddress", "fullName", "firstName", "lastName", "addressLine1", "addressLine2",
  "postalCode", "taxIdentifier", "buyerRegistrationAddress", "buyerCheckoutNotes", "userId", "eiasToken",
]);

/** Deep copy with PII keys replaced by "[redacted]". */
export function stripPii<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripPii) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k) ? "[redacted]" : stripPii(val);
    }
    return out as T;
  }
  return v;
}

/** Response "shape": keys and value types only, arrays reduced to their first element. */
export function shape(v: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `(${v.length} items)`] : [];
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k) ? "[redacted]" : shape(val, depth + 1);
    }
    return out;
  }
  return v === null ? "null" : typeof v;
}
