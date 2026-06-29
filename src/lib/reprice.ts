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
  amazing_max: 49.99,
} as const;

/** Tiers the user can choose to "Move to". Ordered worst → best. */
export type Tier = "breakeven" | "poor" | "average" | "good" | "great" | "amazing" | "stellar";

/** A row's CURRENT profitability band (includes "loss", which isn't a move-to tier). */
export type PorBand = "loss" | "breakeven" | "poor" | "average" | "good" | "great" | "amazing" | "stellar";

export const POR_BAND_OPTIONS: { value: PorBand; label: string }[] = [
  { value: "loss", label: "Loss" },
  { value: "breakeven", label: "Breakeven" },
  { value: "poor", label: "Poor" },
  { value: "average", label: "Average" },
  { value: "good", label: "Good" },
  { value: "great", label: "Great" },
  { value: "amazing", label: "Amazing" },
  { value: "stellar", label: "Stellar" },
];

/**
 * Classify a POR% (e.g. 12.5 for 12.5%) into its profitability band, using the
 * same thresholds as the dashboard. Returns null when POR is unknown.
 */
export function classifyPorBand(porPct: number | null | undefined): PorBand | null {
  if (porPct == null || !isFinite(porPct)) return null;
  if (porPct <= BANDS.loss_max) return "loss";
  if (porPct <= BANDS.breakeven_max) return "breakeven";
  if (porPct <= BANDS.poor_max) return "poor";
  if (porPct <= BANDS.average_max) return "average";
  if (porPct <= BANDS.good_max) return "good";
  if (porPct <= BANDS.great_max) return "great";
  if (porPct <= BANDS.amazing_max) return "amazing";
  return "stellar";
}

export const TIER_OPTIONS: { value: Tier; label: string }[] = [
  { value: "breakeven", label: "Breakeven" },
  { value: "poor", label: "Poor" },
  { value: "average", label: "Average" },
  { value: "good", label: "Good" },
  { value: "great", label: "Great" },
  { value: "amazing", label: "Amazing" },
  { value: "stellar", label: "Stellar" },
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
  stellar: BANDS.amazing_max + EPS, // 50.00
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
 * Sane bounds for the measured VARIABLE eBay fee rate (referral + promoted),
 * decomposed by the RPC as (Σfvf − Ntxns·fixed) / Σ(item + postage). Outside this
 * band the measurement is noise and we fall back to the modeled channel fee.
 */
export const REAL_FEE_MIN = 0.05;
export const REAL_FEE_MAX = 0.25;

/**
 * Resolve the fee inputs for the back-solve. Prefers the measured VARIABLE rate
 * (the RPC has already stripped the fixed fee out), and adds the fixed fee back
 * separately so it does NOT scale with price. Falls back to the modeled channel
 * default when there's no reliable 3DS measurement.
 */
export function feeInputsForBackSolve(
  realFeeRate: number | null | undefined,
  fallback: EffectiveFees,
): { feePct: number; fixedFeeUnit: number; usedReal: boolean } {
  if (realFeeRate != null && realFeeRate >= REAL_FEE_MIN && realFeeRate <= REAL_FEE_MAX) {
    return { feePct: realFeeRate, fixedFeeUnit: fallback.fixedFee, usedReal: true };
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
 * Back-solve the GROSS (inc-VAT) ITEM price that puts a listing at a target POR,
 * accounting for buyer-paid postage (income that offsets courier and is part of
 * the GMV the fee + POR are measured on).
 *
 * Let P = item price (what we set), S = postage (fixed, buyer pays it),
 * G = P + S = GMV inc VAT, v = 1+vat, r = variable fee rate on GMV,
 * F = fixed fee/unit, K = courier/unit, C = cost/unit, t = target POR.
 *
 *   Profit(G) = G/v − r·G − F − K − C
 *   POR       = Profit(G) / G = t
 *   ⇒ G = (F + K + C) / (1/v − r − t)
 *   ⇒ P = G − S
 *
 * Returns null if the target is infeasible (denominator ≤ 0) or inputs are bad.
 *
 * Worked check (NGK-05123): C 2.17, K 1.65, F 0.36, r 0.137, S 1.11, vat 0.20,
 * t 0.10 → G = 4.18 / (0.8333 − 0.137 − 0.10) = £7.01 → P = 7.01 − 1.11 = £5.90.
 */
export function backSolveGrossPrice(args: {
  costUnit: number;
  courierUnit: number;
  fixedFeeUnit: number;
  feePct: number;
  vat: number;
  targetPorFrac: number;
  postageUnit?: number;
}): number | null {
  const { costUnit, courierUnit, fixedFeeUnit, feePct, vat, targetPorFrac, postageUnit = 0 } = args;
  const v = 1 + vat;
  const denom = 1 / v - feePct - targetPorFrac;
  if (denom <= 0) return null;
  const numerator = costUnit + courierUnit + fixedFeeUnit;
  if (!(numerator > 0)) return null;
  const gmv = numerator / denom;
  const p = gmv - postageUnit; // item price = GMV − postage the buyer pays
  if (!isFinite(p) || p <= 0) return null;
  return Math.round(p * 100) / 100;
}

/**
 * A suggested price above this multiple of the current price is a "big move" —
 * surfaced for human review so structurally-thin items (where break-even sits
 * far above the current price) aren't pushed blindly.
 */
export const BIG_MOVE_MULTIPLE = 1.5;

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

/**
 * Default per-unit courier assumption when a SKU-specific courier isn't to hand
 * (mirrors reprice-payoff's COURIER constant). Used by the liquidation floor.
 */
export const DEFAULT_COURIER_UNIT = 1.65;

/**
 * LIQUIDATION FLOOR — the gross price where the sale just covers the cost OF
 * SELLING (channel fee + courier), with the item COST ignored (it's dead stock,
 * sunk). Below this the transaction itself loses money — you'd pay to ship it.
 * This is `backSolveGrossPrice` with cost = 0 and target POR = 0.
 */
export function logisticsBreakevenFloor(args?: {
  courierUnit?: number;
  fees?: EffectiveFees;
  postageUnit?: number;
}): number | null {
  const fees = args?.fees ?? DEFAULT_FEES;
  return backSolveGrossPrice({
    costUnit: 0,
    courierUnit: args?.courierUnit ?? DEFAULT_COURIER_UNIT,
    fixedFeeUnit: fees.fixedFee,
    feePct: fees.feePct,
    vat: fees.vat,
    targetPorFrac: 0,
    postageUnit: args?.postageUnit ?? 0,
  });
}

/**
 * SALE RECOVERY TARGET — the gross price that returns a SKU to the "average"
 * profitability band (POR ≈ 10%), i.e. back into normal trading. Reuses the
 * exact tier the dashboard/repricer use, so a recovered price means the same
 * thing everywhere. Needs the unit cost; courier/fees default to eBay.
 */
export function bandRecoveryTarget(args: {
  costUnit: number;
  courierUnit?: number;
  fees?: EffectiveFees;
  postageUnit?: number;
  tier?: Tier;
}): number | null {
  const fees = args.fees ?? DEFAULT_FEES;
  const tier = args.tier ?? "average";
  return backSolveGrossPrice({
    costUnit: args.costUnit,
    courierUnit: args.courierUnit ?? DEFAULT_COURIER_UNIT,
    fixedFeeUnit: fees.fixedFee,
    feePct: fees.feePct,
    vat: fees.vat,
    targetPorFrac: TIER_TARGET_POR_PCT[tier] / 100,
    postageUnit: args.postageUnit ?? 0,
  });
}
