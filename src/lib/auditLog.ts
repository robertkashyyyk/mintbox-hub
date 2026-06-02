/**
 * logAuditEvent() — shared utility for writing to the append-only audit ledger
 * (spec §5.5). Any mutation in the app can call this to record who changed what.
 *
 * IMPORTANT (spec §5.1 completeness note): this is the application-layer path and
 * is only as complete as developer discipline. For the highest-sensitivity tables
 * (cost price, RBAC/role changes, API key rotation, PO state) a DB-trigger backstop
 * ALSO writes to audit_log so changes are captured even when they bypass the app.
 * That backstop is live — migration 20260601150200_audit_trigger_backstop.sql.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/** Canonical action-type constants (spec §5.2 / §5.3). */
export const AuditActions = {
  // Pricing
  COST_PRICE_UPDATED: "COST_PRICE_UPDATED",
  PRICING_RULE_UPDATED: "PRICING_RULE_UPDATED",
  POR_THRESHOLD_CHANGED: "POR_THRESHOLD_CHANGED",
  // Catalogue
  SKU_CREATED: "SKU_CREATED",
  SKU_EDITED: "SKU_EDITED",
  SKU_DELETED: "SKU_DELETED",
  BRAND_AMENDED: "BRAND_AMENDED",
  SUPPLIER_CHANGED: "SUPPLIER_CHANGED",
  // Stock
  STOCK_ADJUSTED: "STOCK_ADJUSTED",
  STOCK_COUNT_SUBMITTED: "STOCK_COUNT_SUBMITTED",
  MINTSOFT_SYNC: "MINTSOFT_SYNC",
  // Ordering
  PO_CREATED: "PO_CREATED",
  PO_SENT: "PO_SENT",
  PO_RECEIVED: "PO_RECEIVED",
  ASN_DISPATCHED: "ASN_DISPATCHED",
  // Listings
  LISTING_CREATED: "LISTING_CREATED",
  LISTING_EDITED: "LISTING_EDITED",
  LISTING_DELETED: "LISTING_DELETED",
  LISTING_REPRICED: "LISTING_REPRICED",
  // Users
  USER_INVITED: "USER_INVITED",
  ROLE_CHANGED: "ROLE_CHANGED",
  USER_DEACTIVATED: "USER_DEACTIVATED",
  // Tasks
  TASK_CREATED: "TASK_CREATED",
  TASK_ASSIGNED: "TASK_ASSIGNED",
  TASK_STATUS_CHANGED: "TASK_STATUS_CHANGED",
  TASK_PRIORITY_CHANGED: "TASK_PRIORITY_CHANGED",
  TASK_COMPLETED: "TASK_COMPLETED",
  // Admin
  INTEGRATION_SETTINGS_CHANGED: "INTEGRATION_SETTINGS_CHANGED",
  API_KEY_ROTATED: "API_KEY_ROTATED",
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];

export interface LogAuditEventArgs {
  action_type: AuditAction | string;
  entity_type: string;
  entity_id?: string | null;
  entity_label?: string | null;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
}

/**
 * Records an audit entry. The actor is captured automatically from the current
 * session. Never throws — a logging failure must not break the calling mutation;
 * it warns to the console instead.
 */
export async function logAuditEvent(args: LogAuditEventArgs): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      console.warn("[auditLog] skipped — no authenticated user", args.action_type);
      return;
    }

    const actorDisplayName =
      (user.user_metadata?.full_name as string | undefined) ?? user.email ?? null;

    const { error } = await supabase.from("audit_log").insert({
      actor_user_id: user.id,
      actor_display_name: actorDisplayName,
      action_type: args.action_type,
      entity_type: args.entity_type,
      entity_id: args.entity_id ?? null,
      entity_label: args.entity_label ?? null,
      old_value: (args.old_value ?? null) as Json,
      new_value: (args.new_value ?? null) as Json,
      // session_id captured from the access token; IP is added server-side where available.
      session_id: (await supabase.auth.getSession()).data.session?.access_token?.slice(-12) ?? null,
    });

    if (error) console.warn("[auditLog] insert failed:", error.message);
  } catch (err) {
    console.warn("[auditLog] unexpected error:", err);
  }
}
