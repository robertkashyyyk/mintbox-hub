/**
 * Activity Log utility
 *
 * Logs user and system actions to the `activity_log` table.
 * All logging is fire-and-forget — errors are caught and silently swallowed
 * so a logging failure never breaks the feature that triggered it.
 *
 * Usage:
 *   import { logActivity, logSystem } from "@/lib/activityLog";
 *
 *   // Log a user action (call after the action succeeds)
 *   await logActivity({
 *     action: "lsa_calibration.toggle_auto",
 *     entityType: "brand",
 *     entityId: brand.id,
 *     entityLabel: brand.name,
 *     detail: { field: "auto_lsa", old: false, new: true },
 *   });
 *
 *   // Log a system action (no actor_id / actor_email)
 *   await logSystem({
 *     action: "mintsoft.sync_complete",
 *     detail: { products_synced: 42 },
 *   });
 */

import { supabase } from "@/integrations/supabase/client";

export type ActivityOutcome = "success" | "failure" | "info";

interface BaseLogEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  detail?: Record<string, unknown>;
  outcome?: ActivityOutcome;
  errorMessage?: string;
}

/** Log an action taken by the currently signed-in user. */
export async function logActivity(entry: BaseLogEntry): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    await supabase.from("activity_log").insert({
      actor_type: "user",
      actor_id: session?.user?.id ?? null,
      actor_email: session?.user?.email ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      entity_label: entry.entityLabel ?? null,
      detail: entry.detail ?? null,
      outcome: entry.outcome ?? "success",
      error_message: entry.errorMessage ?? null,
    });
  } catch {
    // Never let logging failures surface to the user
  }
}

/** Log an action taken by the system (no human actor). */
export async function logSystem(entry: BaseLogEntry): Promise<void> {
  try {
    await supabase.from("activity_log").insert({
      actor_type: "system",
      actor_id: null,
      actor_email: null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      entity_label: entry.entityLabel ?? null,
      detail: entry.detail ?? null,
      outcome: entry.outcome ?? "info",
      error_message: entry.errorMessage ?? null,
    });
  } catch {
    // Never let logging failures surface to the user
  }
}

// ── Well-known action constants ────────────────────────────────────────────
// Use these instead of raw strings to keep actions consistent across the app.

export const LOG_ACTIONS = {
  // LSA Calibration
  LSA_TOGGLE_AUTO:       "lsa_calibration.toggle_auto",
  LSA_UPDATE_THRESHOLD:  "lsa_calibration.update_threshold",
  LSA_UPDATE_MULTIPLIER: "lsa_calibration.update_multiplier",
  LSA_BULK_APPLY:        "lsa_calibration.bulk_apply",

  // Purchase Orders
  PO_CREATE:             "purchase_order.create",
  PO_UPDATE:             "purchase_order.update",
  PO_SUBMIT:             "purchase_order.submit",
  PO_DELETE:             "purchase_order.delete",
  PO_LINE_ADD:           "purchase_order.line_add",
  PO_LINE_REMOVE:        "purchase_order.line_remove",

  // 3D Reprice
  REPRICE_TRIGGER:       "reprice.trigger",
  REPRICE_COMPLETE:      "reprice.complete",

  // Brands
  BRAND_CREATE:          "brand.create",
  BRAND_UPDATE:          "brand.update",
  BRAND_DELETE:          "brand.delete",

  // System
  MINTSOFT_SYNC:         "system.mintsoft_sync",
  STOCK_HEALTH_REFRESH:  "system.stock_health_refresh",
} as const;

export type LogAction = typeof LOG_ACTIONS[keyof typeof LOG_ACTIONS];
