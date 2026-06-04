/**
 * reprice.ts — pure, side-effect-free pricing maths for the 3D Reprice page.
 *
 * Kept in its own module so the back-solve can be unit-tested in isolation and
 * reused. NOTHING here touches the network, React, or the DOM.
 *
 * Key facts this encodes (verified against the live DB, 2026-06-02):
 *  - order_line_economics stores revenue / price NET (ex-VAT). eBay listing
 *    prices are GROSS (inc VAT), so every price we PUSH must be gross.
 *  - POR% (Profit on Return) = profit / GMV-inc-VAT. The dashboard computes it
 *    as profit / (net_revenue * (1 + vat)). So the POR denominator per unit is
 *    the GROSS unit price.
 *  - eBay fee model (channel_fee_rules "Default"): variable fee = fee_pct of the
 *    GROSS price (0.12), plus a fixed fee per line (0.36). vat_rate 0.20.
 */

/** POR% band thresholds — mirror app_settings.profit.loss_bands. */
export const BANDS = {
  loss_max: -1.0,
  breakeven_max: 1.0,
  poor_max: 9.99,
  average_max: 19.99,
  good_max: 24.99,
  great_max: 29.99,
} as const;

/** Tiers the user can choose to "Move to". Ordered worst → best. */
export type Tier = "breakeven" | "poor" | "average" | "good" | "great" | "amazing";

export const TIER_OPTIONS: { value: Tier; label: string }[] = [
  { value: "breakeven", label: "Breakeven" },
  { value: "poor", label: "Poor" },
  { value: "average", label: "Average" },
  { value: "good", label: "Good" },
  { value: "great", label: "Great" },
  { value: "amazing", label: "Amazing" },
];

/**
 * Target POR (as a %) for each tier = the band FLOOR (the gentlest price rise
 * that still lands the line inside the chosen band). A tiny epsilon is added so
 * a value sitting exactly on a boundary classifies INTO the band, not below it
 * (the classifier uses `por <= threshold`). "breakeven" targets a true 0%.
 */
const EPS = 0.01;
export const TIER_TARGET_POR_PCT: Record<Tier, number> = {
  breakeven: 0,
  poor: BANDS.breakeven_max + EPS, // 1.01
  average: BANDS.poor_max + EPS, // 10.00
  good: BANDS.average_max + EPS, // 20.00
  great: BANDS.good_max + EPS, // 25.00
  amazing: BANDS.great_max + EPS, // 30.00
};

/** A row of channel_fee_rules. */
export interface FeeRule {
  channel_pattern: string;
  vat_rate: number;
  fee_pct: number;
  fixed_fee: number;
  priority: number;
  active: boolean;
}

/** Effective fees for a channel after rule-matching, with sane eBay defaults. */
export interface EffectiveFees {
  vat: number; // e.g. 0.20
  feePct: number; // referral rate on GROSS price, e.g. 0.12
  fixedFee: number; // fixed fee per unit/line, e.g. 0.36
}

export const DEFAULT_FEES: EffectiveFees = { vat: 0.2, feePct: 0.12, fixedFee: 0.36 };

/**
 * Sane bounds for a MEASURED eBay fee rate (final_value_fee / gross price, from
 * the 3DS orders feed). Outside this band the measurement is noise (e.g. a single
 * refunded/odd line) and we fall back to the modeled channel fee.
 */
export const REAL_FEE_MIN = 0.05;
export const REAL_FEE_MAX = 0.4;

/**
 * Resolve the fee inputs for the back-solve. Prefers the measured real fee rate
 * (fvf/gross — which ALREADY includes the £0.36 fixed fee + promoted-listing
 * fees, so fixedFeeUnit becomes 0) over the modeled channel default.
 */
export function feeInputsForBackSolve(
  realFeeRate: number | null | undefined,
  fallback: EffectiveFees,
): { feePct: number; fixedFeeUnit: number; usedReal: boolean } {
  if (realFeeRate != null && realFeeRate >= REAL_FEE_MIN && realFeeRate <= REAL_FEE_MAX) {
    return { feePct: realFeeRate, fixedFeeUnit: 0, usedReal: true };
  }
  return { feePct: fallback.feePct, fixedFeeUnit: fallback.fixedFee, usedReal: false };
}

/** Convert a SQL LIKE pattern (%, _) to an anchored, case-insensitive RegExp. */
function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex specials
    .replace(/%/g, ".*") // SQL % → any run
    .replace(/_/g, "."); // SQL _ → any single char
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Pick the fee rule for a channel: lowest-priority ACTIVE rule whose pattern
 * matches. Falls back to eBay defaults if nothing matches / no rules loaded.
 */
export function effectiveFeesFor(channel: string, rules: FeeRule[] | null | undefined): EffectiveFees {
  const active = (rules ?? []).filter((r) => r.active).sort((a, b) => a.priority - b.priority);
  const hit = active.find((r) => likeToRegExp(r.channel_pattern).test(channel));
  if (!hit) return DEFAULT_FEES;
  return { vat: hit.vat_rate, feePct: hit.fee_pct, fixedFee: hit.fixed_fee };
}

/**
 * Back-solve the GROSS (inc-VAT) unit price that puts a line at a target POR.
 *
 *   Profit(P) = P/v − r·P − F − C            (v = 1+vat, r = feePct on gross)
 *   POR       = Profit(P) / P                 (denominator = gross price)
 *   ⇒ P = (C + F) / (1/v − r − t)             (t = target POR fraction)
 *
 * where C = landed cost / unit, F = fixed costs / unit (courier + fixed fee).
 * Returns null if the target is infeasible (denominator ≤ 0) or inputs are bad.
 *
 * Worked check (spec §"suggestPrice bug"): C+courier 9.00, feePct 0.12,
 * fixedFee 0, vat 0.20, t 0 → P = 9 / (0.8333 − 0.12) = £12.62 break-even gross.
 */
export function backSolveGrossPrice(args: {
  costUnit: number;
  courierUnit: number;
  fixedFeeUnit: number;
  feePct: number;
  vat: number;
  targetPorFrac: number;
}): number | null {
  const { costUnit, courierUnit, fixedFeeUnit, feePct, vat, targetPorFrac } = args;
  const v = 1 + vat;
  const denom = 1 / v - feePct - targetPorFrac;
  if (denom <= 0) return null;
  const numerator = costUnit + courierUnit + fixedFeeUnit;
  if (!(numerator > 0)) return null;
  const p = numerator / denom;
  if (!isFinite(p) || p <= 0) return null;
  return Math.round(p * 100) / 100;
}

export type CostFlag = null | "missing_cost" | "suspect_cost";

/** Cost above this multiple of the gross sale price is treated as a data error. */
export const SUSPECT_COST_MULTIPLE = 3;

/**
 * Classify a row's cost quality:
 *  - "missing_cost": no usable cost (0 / null) → NOT a reprice candidate.
 *  - "suspect_cost": cost/unit implausibly high vs the gross sale price
 *    (likely a pack/case cost stored against a single-unit listing) → NOT a
 *    reprice candidate until the cost is fixed.
 */
export function classifyCost(args: {
  costTotal: number | null | undefined;
  unitsSold: number;
  grossPrice: number | null | undefined;
}): CostFlag {
  const { costTotal, unitsSold, grossPrice } = args;
  if (costTotal == null || costTotal <= 0 || unitsSold <= 0) return "missing_cost";
  const costUnit = costTotal / unitsSold;
  if (costUnit <= 0) return "missing_cost";
  if (grossPrice != null && grossPrice > 0 && costUnit > grossPrice * SUSPECT_COST_MULTIPLE) {
    return "suspect_cost";
  }
  return null;
}

/** Net (ex-VAT) → gross (inc-VAT). */
export function toGross(net: number | null | undefined, vat: number): number | null {
  if (net == null) return null;
  return net * (1 + vat);
}
