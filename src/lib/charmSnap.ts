// Charm-price snapper — deterministic price-in/price-out formatting step that runs
// AFTER the repricer's min-profitable-price (the "floor") is computed. It snaps that
// floor up to an allowed charm price. Ported from the verified prototype
// (PartsDoc_Charm_Price_Snapper.xlsx / Charm_Snapper_CC_Handoff.md).
//
// Pure + stateless. Works in integer pence internally for float safety.
// The ladder is CONFIG: the source of truth is the public.price_sweetspots table;
// DEFAULT_LADDER below is a fallback used only if that fetch fails.

export type LadderType = "standard" | "magnet" | "reluctant";
export interface LadderEntry {
  pence: number;
  type?: LadderType; // absent = standard
}
export type SnapChannel = "charm" | "buybox";
export type SnapFlag =
  | "buybox-raw"   // Amazon buy-box — leave the raw competitive number alone
  | "clean"        // snapped up to a standard rung
  | "hemmed"       // forced onto a "reluctant" over-barrier rung — worth eyeballing
  | "magnet-catch" // tolerance let it drop to a magnet just below floor
  | "above-ladder"; // floor is above the top rung — extend the ladder (logged, not snapped)

export interface SnapResult {
  listPrice: number | null; // £, or null when above-ladder
  flag: SnapFlag;
}

// Fallback ladder (mirrors public.price_sweetspots). Prices in pence.
// All endings .95; finer .25/.45/.75/.95 steps under £10; dead zones skipped.
export const DEFAULT_LADDER: LadderEntry[] = [
  { pence: 125 }, { pence: 145 }, { pence: 175 }, { pence: 195 },
  { pence: 225 }, { pence: 245 }, { pence: 275 }, { pence: 295 },
  { pence: 325 }, { pence: 345 }, { pence: 375 }, { pence: 395 },
  { pence: 425 }, { pence: 445 }, { pence: 475 }, { pence: 495, type: "magnet" },
  { pence: 525 }, { pence: 545 }, { pence: 575 }, { pence: 595 },
  { pence: 625 }, { pence: 645 }, { pence: 675 }, { pence: 695 },
  { pence: 725 }, { pence: 745 }, { pence: 775 }, { pence: 795 },
  { pence: 825 }, { pence: 845 }, { pence: 875 }, { pence: 895 },
  { pence: 925 }, { pence: 945 }, { pence: 975 }, { pence: 995, type: "magnet" },
  { pence: 1095, type: "reluctant" },
  { pence: 1195 }, { pence: 1295 }, { pence: 1395 }, { pence: 1495 },
  { pence: 1595 }, { pence: 1695 }, { pence: 1795 },
  { pence: 1995, type: "magnet" },
  { pence: 2095, type: "reluctant" }, { pence: 2195, type: "reluctant" },
  { pence: 2295 }, { pence: 2495 }, { pence: 2695 }, { pence: 2795 },
  { pence: 2995, type: "magnet" },
  { pence: 3295 }, { pence: 3495 }, { pence: 3795 },
  { pence: 3995, type: "magnet" },
  { pence: 4295 }, { pence: 4495 }, { pence: 4795 },
  { pence: 4995, type: "magnet" },
  { pence: 5095, type: "reluctant" },
  { pence: 5295 }, { pence: 5495 }, { pence: 5795 },
  { pence: 5995, type: "magnet" },
  { pence: 6295 }, { pence: 6495 }, { pence: 6795 },
  { pence: 6995, type: "magnet" },
  { pence: 7295 }, { pence: 7495 }, { pence: 7795 },
  { pence: 7995, type: "magnet" },
  { pence: 8495 }, { pence: 8995, type: "magnet" },
  { pence: 9995, type: "magnet" },
  { pence: 10995 }, { pence: 11995 }, { pence: 12995 }, { pence: 13995 },
  { pence: 14995, type: "magnet" },
  { pence: 15995 }, { pence: 16995 }, { pence: 17995 }, { pence: 18995 },
  { pence: 19995, type: "magnet" },
];

/**
 * Snap a computed floor price to an allowed charm price.
 * @param calcPrice the repricer's floor / min-profitable price (£)
 * @param channel   "charm" (eBay / non-buy-box) or "buybox" (Amazon — left raw)
 * @param tolerance pence a price may drop BELOW floor to catch a magnet (default 0 = floor protected)
 * @param ladder    the charm ladder (defaults to DEFAULT_LADDER; pass the table-loaded one)
 */
export function snapPrice(
  calcPrice: number,
  channel: SnapChannel,
  tolerance = 0,
  ladder: LadderEntry[] = DEFAULT_LADDER,
): SnapResult {
  const floor = Math.round(calcPrice * 100); // pence
  if (channel === "buybox") return { listPrice: floor / 100, flag: "buybox-raw" };

  const prices = ladder.map((r) => r.pence);
  const magnets = ladder.filter((r) => r.type === "magnet").map((r) => r.pence);
  const reluctant = new Set(ladder.filter((r) => r.type === "reluctant").map((r) => r.pence));
  const tolP = Math.round(tolerance * 100);

  const atOrAbove = prices.filter((p) => p >= floor);
  if (atOrAbove.length === 0) return { listPrice: null, flag: "above-ladder" };
  const snapUp = Math.min(...atOrAbove);

  const below = magnets.filter((p) => p < floor);
  const magnetBelow = below.length ? Math.max(...below) : null;

  if (tolP > 0 && magnetBelow !== null && floor - magnetBelow <= tolP) {
    return { listPrice: magnetBelow / 100, flag: "magnet-catch" };
  }
  return { listPrice: snapUp / 100, flag: reluctant.has(snapUp) ? "hemmed" : "clean" };
}

/** Build a ladder (pence, ascending) from public.price_sweetspots rows (£ + type). */
export function ladderFromRows(
  rows: Array<{ price: number | string; type?: string | null }>,
): LadderEntry[] {
  return rows
    .map((r) => ({
      pence: Math.round(Number(r.price) * 100),
      type: (r.type === "magnet" || r.type === "reluctant" ? r.type : undefined) as LadderType | undefined,
    }))
    .filter((r) => Number.isFinite(r.pence) && r.pence > 0)
    .sort((a, b) => a.pence - b.pence);
}
