/**
 * gtc.ts — builds rows for the 3D Sellers GTC (fixed-price) listing import
 * template. Shared by Opportunities (ad-hoc generate) and the Listing Queue
 * drain so there is ONE source of truth for the column order + mapping.
 *
 * Draft values (listing_drafts) win over catalogue; price falls back to the
 * Good band. Several fields are best-effort (dims order, weight units, MPN) and
 * are validated by a real 3D import — keep them in sync with the template.
 */
import { bandRecoveryTarget } from "@/lib/reprice";

export const GTC_HEADERS = ["SKU","Title","Description","Tags","MetaKeywords","MetaDescription","MobileDescription","CategoryID","StoreCategory","PrivateListing","UpToQuantity","WarehouseQuantity","InventoryControl","Price","Cost","BestOffer","BestOfferAccept","BestOfferDecline","C:MPN","C:Brand","C:Size","Condition","CountryCode","Location","PostalCode","PolicyPayment","PolicyShipping","PolicyReturn","PackageType","MeasurementSystem","PackageLength","PackageWidth","PackageDepth","WeightMajor","WeightMinor","Image 1"];

export interface ListingData {
  sku: string; title: string; description: string | null; brand_name: string | null; barcode: string | null;
  cost_price: number; stock: number; ebay_category_id: string | null; mpn: string | null; size: string | null;
  condition: string | null; price: number | null; weight: number | null; height: number | null; length: number | null;
  depth: number | null; image_url: string | null;
}
export interface StoreCfg {
  store_id: string; policy_payment: string | null; policy_shipping: string | null; policy_return: string | null;
  location: string | null; postal_code: string | null; country_code: string; default_condition: string;
  measurement_system: string; package_type: string; best_offer: boolean;
}

export const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function gtcRow(d: ListingData, cfg: StoreCfg | undefined): string[] {
  const price = d.price != null ? Number(d.price) : bandRecoveryTarget({ costUnit: Number(d.cost_price || 0), tier: "good" });
  return [
    d.sku, (d.title ?? "").slice(0, 80),
    d.description ?? `<p>${(d.title ?? d.sku)}${d.brand_name ? " — " + d.brand_name : ""}</p>`,
    "", "", "", "",
    d.ebay_category_id ?? "", "",
    "FALSE", String(d.stock ?? 1), String(d.stock ?? 1), "True",
    price != null ? Number(price).toFixed(2) : "", Number(d.cost_price || 0).toFixed(2),
    cfg?.best_offer ? "TRUE" : "FALSE", "", "",
    d.mpn ?? "", d.brand_name ?? "", d.size ?? "",
    d.condition ?? cfg?.default_condition ?? "1000", cfg?.country_code ?? "GB", cfg?.location ?? "", cfg?.postal_code ?? "",
    cfg?.policy_payment ?? "", cfg?.policy_shipping ?? "", cfg?.policy_return ?? "",
    cfg?.package_type ?? "PackageThickEnvelope", cfg?.measurement_system ?? "METRIC",
    d.length != null ? String(d.length) : "", d.depth != null ? String(d.depth) : "", d.height != null ? String(d.height) : "",
    d.weight != null ? String(d.weight) : "", "0",
    d.image_url ?? "",
  ];
}

export function buildGtcCsv(rows: { data: ListingData; cfg: StoreCfg | undefined }[]): string {
  return [GTC_HEADERS, ...rows.map(r => gtcRow(r.data, r.cfg))].map(r => r.map(csvCell).join(",")).join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}
