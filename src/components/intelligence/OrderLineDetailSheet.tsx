import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";

/** The minimal shape we need from an order_line_economics row to open the sheet. */
export interface SelectedLine {
  mintsoft_order_id: number | string;
  line_index?: number | null;
  sku: string;
  channel?: string | null;
}

const CCY_SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$", AUD: "A$" };
const money = (v: number | null | undefined, ccy = "GBP") =>
  v == null ? "—" : `${CCY_SYMBOL[ccy] ?? ""}${Number(v).toFixed(2)}`;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`);
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";

/** Strip a trailing -Q0N pack token to get the base (single) SKU. */
const baseSkuOf = (sku: string) => sku.replace(/-Q[0-9]+$/i, "");

interface OrderLine {
  mintsoft_order_id: number;
  line_index: number | null;
  sku: string;
  product_name: string | null;
  channel: string | null;
  qty: number | null;
  price: number | null;
  cost_each: number | null;
  courier_cost: number | null;
  channel_fee: number | null;
  profit: number | null;
  por_pct: number | null;
  order_value: number | null;
  order_date: string | null;
  fee_rule_name: string | null;
  good_dirt: string | null;
  missing_cost: boolean | null;
}

interface Listing {
  base_sku: string;
  sku: string;
  q_code: string | null;
  pack_size: number | null;
  external_item_id: string | null;
  marketplace: string | null;
  store_name: string | null;
  item_name: string | null;
  item_url: string | null;
  currency: string | null;
  last_unit_price: number | null;
  last_order_date: string | null;
  units_90d: number | null;
  real_fee_rate: number | null;
}

export default function OrderLineDetailSheet({
  line,
  open,
  onOpenChange,
}: {
  line: SelectedLine | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const orderId = line?.mintsoft_order_id ?? null;

  // All lines in this order (the full basket + per-line Mintsoft economics).
  const { data: orderLines, isLoading: linesLoading } = useQuery({
    queryKey: ["order-detail-lines", orderId],
    enabled: open && orderId != null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_line_economics")
        .select(
          "mintsoft_order_id, line_index, sku, product_name, channel, qty, price, cost_each, courier_cost, channel_fee, profit, por_pct, order_value, order_date, fee_rule_name, good_dirt, missing_cost",
        )
        .eq("mintsoft_order_id", orderId as any)
        .order("line_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OrderLine[];
    },
  });

  // Real eBay listings (from the 3DS orders feed) for every product in the order.
  const baseSkus = Array.from(new Set((orderLines ?? []).map((l) => baseSkuOf(l.sku))));
  const { data: listings, isLoading: listingsLoading, isError: listingsError } = useQuery({
    queryKey: ["order-detail-listings", orderId, baseSkus.join(",")],
    enabled: open && baseSkus.length > 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("threeds_listings" as any)
        .select(
          "base_sku, sku, q_code, pack_size, external_item_id, marketplace, store_name, item_name, item_url, currency, last_unit_price, last_order_date, units_90d, real_fee_rate",
        )
        .in("base_sku", baseSkus)
        .order("units_90d", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Listing[];
    },
  });

  const orderDate = orderLines?.[0]?.order_date ?? null;
  const orderTotal = (orderLines ?? []).reduce((s, l) => s + (Number(l.order_value) || 0), 0);
  const orderProfit = (orderLines ?? []).reduce((s, l) => s + (Number(l.profit) || 0), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono">Order {orderId ?? "—"}</SheetTitle>
          <SheetDescription>
            {line?.channel ?? "—"} · {fmtDate(orderDate)} · everything we hold on this order and its products
          </SheetDescription>
        </SheetHeader>

        {/* Order summary */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <SummaryStat label="Lines" value={String(orderLines?.length ?? 0)} />
          <SummaryStat label="Order value (net)" value={money(orderTotal)} />
          <SummaryStat
            label="Order profit"
            value={money(orderProfit)}
            className={orderProfit < 0 ? "text-destructive" : ""}
          />
        </div>

        {/* Mintsoft per-line economics */}
        <section className="mt-6">
          <h3 className="text-sm font-semibold mb-2">Order lines — Mintsoft economics</h3>
          {linesLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Courier</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">POR</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(orderLines ?? []).map((l, i) => {
                    const highlight = l.sku === line?.sku;
                    return (
                      <TableRow key={`${l.sku}-${l.line_index}-${i}`} className={highlight ? "bg-pd-accent/10" : ""}>
                        <TableCell className="font-mono text-xs">
                          {l.sku}
                          <div className="text-[10px] text-muted-foreground font-sans">{l.product_name}</div>
                        </TableCell>
                        <TableCell className="text-right">{l.qty}</TableCell>
                        <TableCell className="text-right">{money(l.price)}</TableCell>
                        <TableCell className="text-right">{money(l.cost_each)}</TableCell>
                        <TableCell className="text-right">{money(l.courier_cost)}</TableCell>
                        <TableCell className="text-right">{money(l.channel_fee)}</TableCell>
                        <TableCell className={`text-right font-medium ${Number(l.profit) < 0 ? "text-destructive" : ""}`}>
                          {money(l.profit)}
                        </TableCell>
                        <TableCell className="text-right">{l.por_pct == null ? "—" : `${(Number(l.por_pct) * 100).toFixed(1)}%`}</TableCell>
                        <TableCell className="space-x-1 whitespace-nowrap">
                          {l.missing_cost && <Badge variant="destructive" className="text-[10px]">no cost</Badge>}
                          {l.good_dirt === "Dirt" && <Badge variant="outline" className="text-[10px] border-warning text-warning">dirt</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">
            Price/cost are NET (ex-VAT). Mintsoft collapses eBay pack listings into the base SKU — see the real listings below.
          </p>
        </section>

        {/* Real eBay listings from 3DS */}
        <section className="mt-6">
          <h3 className="text-sm font-semibold mb-2">Real eBay listings (3DS orders)</h3>
          {listingsLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : listingsError ? (
            <p className="text-xs text-muted-foreground">3DS listings unavailable.</p>
          ) : !listings || listings.length === 0 ? (
            <p className="text-xs text-muted-foreground">No 3DS listing data found for these SKUs yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>eBay item #</TableHead>
                    <TableHead>Market</TableHead>
                    <TableHead className="text-center">Pack</TableHead>
                    <TableHead className="text-right">Pack price</TableHead>
                    <TableHead className="text-right">Per item</TableHead>
                    <TableHead className="text-right">Units 90d</TableHead>
                    <TableHead className="text-right">Real fee</TableHead>
                    <TableHead className="text-right">Last sold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listings.map((lst, i) => {
                    const pack = lst.pack_size ?? 1;
                    return (
                      <TableRow key={`${lst.external_item_id}-${i}`}>
                        <TableCell className="font-mono text-xs">{lst.sku}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {lst.item_url ? (
                            <a href={lst.item_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-pd-accent hover:underline">
                              {lst.external_item_id}<ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (lst.external_item_id ?? "—")}
                        </TableCell>
                        <TableCell className="text-xs">{lst.marketplace ?? "—"}</TableCell>
                        <TableCell className="text-center">
                          {pack > 1 ? <Badge variant="secondary" className="font-mono text-[10px]">{pack}-pack</Badge> : <span className="text-muted-foreground text-xs">single</span>}
                        </TableCell>
                        <TableCell className="text-right">{money(lst.last_unit_price, lst.currency ?? "GBP")}</TableCell>
                        <TableCell className="text-right">{pack > 1 && lst.last_unit_price != null ? money(lst.last_unit_price / pack, lst.currency ?? "GBP") : "—"}</TableCell>
                        <TableCell className="text-right">{lst.units_90d ?? 0}</TableCell>
                        <TableCell className="text-right">{pct(lst.real_fee_rate)}</TableCell>
                        <TableCell className="text-right text-xs">{fmtDate(lst.last_order_date)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">
            Pack price is the listing's selling unit (a -Q0N row is an N-pack). 3DS prices are item-only (ex-postage).
          </p>
        </section>
      </SheetContent>
    </Sheet>
  );
}

function SummaryStat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${className}`}>{value}</div>
    </div>
  );
}
