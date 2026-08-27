import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, ArrowRight, Info, FlaskConical, Loader2, RotateCcw, ChevronRight, ChevronDown, Layers, Lock, CalendarClock, Save } from "lucide-react";
import { ElasticityProposals } from "@/components/intelligence/ElasticityProposals";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
interface WindowCfg { day: number; start_hour: number; duration_hours: number; open_until?: string | null }

// Sellers launch window (default Fridays). One-time open_until override wins while future.
function useSellersWindow() {
  const { data: cfg } = useQuery({
    queryKey: ["elasticity_sellers_window"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("app_settings").select("value").eq("key", "elasticity.sellers_window").maybeSingle();
      return (data?.value ?? { day: 5, start_hour: 9, duration_hours: 24 }) as WindowCfg;
    },
  });
  return useMemo(() => {
    if (!cfg) return { open: false, message: "Loading…", cfg: null as WindowCfg | null };
    const now = new Date();
    if (cfg.open_until && now < new Date(cfg.open_until)) {
      const until = new Date(cfg.open_until).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit" });
      return { open: true, message: `One-off window — open until ${until}`, cfg };
    }
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const wdIdx = DAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
    const minsNow = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) * 60 + parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const minsSinceOpen = ((wdIdx - cfg.day + 7) % 7) * 1440 + minsNow - cfg.start_hour * 60;
    const open = minsSinceOpen >= 0 && minsSinceOpen < cfg.duration_hours * 60;
    const hh = String(cfg.start_hour).padStart(2, "0");
    return { open, message: open ? `Open until +${cfg.duration_hours}h` : `Opens ${DAYS[cfg.day]} ${hh}:00 (UK)`, cfg };
  }, [cfg]);
}

const gbp = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n));
const num = (v: any) => (typeof v === "number" ? v : parseFloat(String(v ?? 0))) || 0;
const brandCodeOf = (sku: string) => (sku.split("-")[0] || "").toUpperCase();

const TIER_OPTS = ["poor", "average", "good", "great", "amazing", "stellar"] as const;
const tierTone = (t: string) =>
  t === "stellar" || t === "amazing" ? "border-band-good/50 bg-band-good/10 text-band-good"
  : t === "great" || t === "good" ? "border-band-average/50 bg-band-average/10 text-band-average"
  : t === "average" ? "text-foreground"
  : t === "poor" ? "border-band-poor/50 bg-band-poor/10 text-band-poor"
  : "border-band-loss/50 bg-band-loss/10 text-band-loss";

interface Seller {
  sku: string; brand_name: string | null; stores: number; units: number; units_per_wk: number;
  revenue_ex: number; cost_total: number; courier_total: number; fees_total: number; profit: number;
  cur_por: number; tier: string; avg_price_inc: number; min_price_inc: number; max_price_inc: number;
  cost_unit: number; courier_unit: number; fee_rate: number; current_stock: number | null; pack_count: number;
}
interface RuleGroup { id: string; name: string; single_tier: string; pack_tier: string; }
interface FamilyRow { tier_sku: string; pack_size: number; target_tier: string; price: number; per_unit: number; profit: number; por: number; }
type SortKey = "units_per_wk" | "cur_por" | "avg_price_inc" | "pack_count" | "sku" | "brand_name" | "current_stock";

export function ElasticityWorkbench() {
  return (
    <Tabs defaultValue="sellers" className="space-y-4">
      <TabsList>
        <TabsTrigger value="sellers">Sellers</TabsTrigger>
        <TabsTrigger value="tests">Live tests</TabsTrigger>
        <TabsTrigger value="engine">Engine picks</TabsTrigger>
        <TabsTrigger value="rules">Rules</TabsTrigger>
      </TabsList>
      <TabsContent value="sellers"><SellersTab /></TabsContent>
      <TabsContent value="tests"><TestsTab /></TabsContent>
      <TabsContent value="engine"><ElasticityProposals /></TabsContent>
      <TabsContent value="rules"><ElasticityRules /></TabsContent>
    </Tabs>
  );
}

function SellersTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const win = useSellersWindow();
  const [brand, setBrand] = useState("all");
  const [topN, setTopN] = useState("100");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "units_per_wk", dir: "desc" });
  const [override, setOverride] = useState<Record<string, { single?: string; pack?: string }>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: sellers, isLoading } = useQuery({
    queryKey: ["elasticity_sellers"],
    enabled: win.open,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_elasticity_sellers", { p_days: 30, p_min_units: 4 });
      if (error) throw error;
      return (data ?? []) as Seller[];
    },
  });
  const { data: ebayStores } = useQuery({
    queryKey: ["ebay-stores-enabled"],
    queryFn: async () => {
      const { data, error } = await supabase.from("threeds_stores").select("id, store_name, mintsoft_channel, enabled").eq("enabled", true);
      if (error) throw error;
      return (data ?? []).filter((s: any) => (s.mintsoft_channel ?? "").toLowerCase().startsWith("ebay"));
    },
  });
  // SKUs with a live test — hide them from Sellers so they can't be re-tested.
  const { data: activeTestSkus } = useQuery({
    queryKey: ["elasticity_active_test_skus"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("elasticity_tests").select("sku").eq("status", "active");
      return new Set((data ?? []).map((r: any) => r.sku as string));
    },
  });
  const { data: groups } = useQuery({
    queryKey: ["elasticity_rule_groups"],
    queryFn: async () => {
      const [g, m] = await Promise.all([
        (supabase as any).from("elasticity_rule_groups").select("*"),
        (supabase as any).from("brand_rule_group").select("brand_code, group_id"),
      ]);
      const byId: Record<string, RuleGroup> = {};
      (g.data ?? []).forEach((x: RuleGroup) => (byId[x.id] = x));
      const brandToGroup: Record<string, string> = {};
      (m.data ?? []).forEach((x: any) => (brandToGroup[x.brand_code] = x.group_id));
      return { byId, brandToGroup };
    },
  });

  // Effective tiers for a row: user override → brand's rule group → default good/good.
  const tiersFor = (s: Seller): { single: string; pack: string; groupName: string } => {
    const g = groups?.byId[groups?.brandToGroup[brandCodeOf(s.sku)] ?? ""] ?? null;
    return {
      single: override[s.sku]?.single ?? g?.single_tier ?? "good",
      pack: override[s.sku]?.pack ?? g?.pack_tier ?? "good",
      groupName: g?.name ?? "default",
    };
  };

  const brands = useMemo(() => Array.from(new Set((sellers ?? []).map((s) => s.brand_name).filter(Boolean) as string[])).sort(), [sellers]);
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "sku" || key === "brand_name" ? "asc" : "desc" }));

  const rows = useMemo(() => {
    let r = [...(sellers ?? [])];
    r = r.filter((s) => !activeTestSkus?.has(s.sku)); // hide lines already under test
    if (brand !== "all") r = r.filter((s) => (s.brand_name ?? "") === brand);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((s) => s.sku.toLowerCase().includes(q) || (s.brand_name ?? "").toLowerCase().includes(q));
    const { key, dir } = sort; const mul = dir === "asc" ? 1 : -1;
    r.sort((a, b) => {
      const av = a[key] as any, bv = b[key] as any;
      if (typeof av === "string" || typeof bv === "string") return String(av ?? "").localeCompare(String(bv ?? "")) * mul;
      return (num(av) - num(bv)) * mul;
    });
    return r;
  }, [sellers, brand, search, sort, activeTestSkus]);
  const shown = topN === "all" ? rows : rows.slice(0, parseInt(topN, 10));

  const testMutation = useMutation({
    mutationFn: async (s: Seller) => {
      const { single, pack } = tiersFor(s);
      const stores = ebayStores ?? [];
      if (stores.length === 0) throw new Error("No eBay stores found");
      const { data: family, error: fErr } = await (supabase as any).rpc("get_elasticity_family", { p_sku: s.sku, p_single_tier: single, p_pack_tier: pack });
      if (fErr) throw new Error(fErr.message);
      const fam = (family ?? []) as FamilyRow[];
      if (fam.length === 0) throw new Error("Nothing to price for this SKU");
      const { data: base } = await (supabase as any).rpc("get_family_baseline", { p_sku: s.sku, p_days: 30 });
      const baseline = (base ?? [])[0] ?? { units_wk: s.units_per_wk, profit_wk: null };
      const pushRows = fam.map((f) => ({ sku: f.tier_sku, new_price: Number(num(f.price).toFixed(2)) }));
      let pushed = 0; const failures: string[] = [];
      for (const st of stores) {
        const { data, error } = await supabase.functions.invoke("threeds-reprice-push", { body: { store_id: st.id, source: "elasticity", rows: pushRows } });
        if (error || (data as any)?.error) failures.push(st.store_name); else pushed++;
      }
      if (pushed === 0) throw new Error(`Push failed on all stores: ${failures.join(", ")}`);
      const atom = fam.find((f) => f.tier_sku === s.sku) ?? fam[0];
      const { error: insErr } = await (supabase as any).from("elasticity_tests").insert({
        sku: s.sku, brand_name: s.brand_name, target_tier: `${single}/${pack}`, single_tier: single, pack_tier: pack,
        baseline_price_inc: Number(num(s.avg_price_inc).toFixed(2)), test_price_inc: Number(num(atom.price).toFixed(2)),
        stores_pushed: pushed, baseline_units_wk: num(baseline.units_wk), baseline_profit_wk: baseline.profit_wk == null ? null : num(baseline.profit_wk),
      });
      if (insErr) throw new Error(insErr.message);
      return { sku: s.sku, tiers: fam.length, pushed, stores: stores.length, failures };
    },
    onSuccess: (d) => {
      toast({ title: "Family test started", description: `${d.sku}: ${d.tiers} price${d.tiers === 1 ? "" : "s"} (single + packs) pushed to ${d.pushed}/${d.stores} eBay stores${d.failures.length ? ` (failed: ${d.failures.join(", ")})` : ""}. Watch it on Live tests.` });
      qc.invalidateQueries({ queryKey: ["elasticity_tests_tracking"] });
      qc.invalidateQueries({ queryKey: ["elasticity_active_test_skus"] }); // drop the line from Sellers now
    },
    onError: (e: Error) => toast({ title: "Couldn’t start test", description: e.message, variant: "destructive" }),
  });
  const busySku = testMutation.isPending ? (testMutation.variables as Seller)?.sku : null;

  const SortHead = ({ k, label, align = "left" }: { k: SortKey; label: string; align?: "left" | "right" }) => (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-foreground transition ${align === "right" ? "flex-row-reverse" : ""} ${sort.key === k ? "text-foreground" : "text-muted-foreground"}`}>
        {label}{sort.key === k ? (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </TableHead>
  );

  if (!win.open) {
    return (
      <Card>
        <CardContent className="py-16 flex flex-col items-center text-center gap-3">
          <div className="rounded-full bg-muted p-3"><Lock className="h-6 w-6 text-muted-foreground" /></div>
          <div className="text-lg font-semibold">Sellers is closed</div>
          <div className="text-sm text-muted-foreground max-w-md">
            To keep reads clean, new tests only launch in a weekly window. <strong>{win.message}.</strong> This way every
            test gets a full, undisturbed week before the next decision — no acting on sales still sitting at the old price.
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1"><CalendarClock className="h-3 w-3" /> Live tests stay viewable any day. Adjust the window on the Rules tab.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Elasticity sellers — price the whole family across all eBay stores</AlertTitle>
        <AlertDescription>
          Each atom rolls up across all {ebayStores?.length ?? 5} stores. Two tiers per line — <strong>Single</strong> and{" "}
          <strong>Packs</strong> — pre-filled from the brand’s rule group. Each tier is priced to its POR and the shared
          large-letter postage auto-ladders the packs (bigger pack = lower per-unit). <strong>Test &amp; Track</strong>{" "}
          derives the atom + every −Q, snaps to charm, and pushes them all to every store at once.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={brand} onValueChange={setBrand}>
              <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Brand" /></SelectTrigger>
              <SelectContent className="max-h-[320px]"><SelectItem value="all">All brands</SelectItem>{brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={topN} onValueChange={setTopN}>
              <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{["50", "100", "200", "all"].map((t) => <SelectItem key={t} value={t}>{t === "all" ? "All" : `Top ${t}`}</SelectItem>)}</SelectContent>
            </Select>
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search SKU / brand…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-[180px] h-9" /></div>
            <span className="text-xs text-muted-foreground ml-auto">{shown.length} of {rows.length}</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <Skeleton className="h-40 w-full" /> : shown.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No eBay sellers match this view.</div>
          ) : (
            <div className="rounded-md border-t [&>div]:max-h-[70vh] [&>div]:overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="w-6"></TableHead>
                    <SortHead k="sku" label="SKU" />
                    <SortHead k="brand_name" label="Brand" />
                    <SortHead k="units_per_wk" label="Units /wk" align="right" />
                    <SortHead k="avg_price_inc" label="Current" align="right" />
                    <SortHead k="cur_por" label="Tier" align="right" />
                    <SortHead k="pack_count" label="Packs" align="right" />
                    <TableHead>Single →</TableHead>
                    <TableHead>Packs →</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((s) => {
                    const eff = tiersFor(s);
                    const isOpen = !!expanded[s.sku];
                    return (
                      <Fragment key={s.sku}>
                        <TableRow>
                          <TableCell className="p-0 pl-2">
                            {s.pack_count > 0 && (
                              <button onClick={() => setExpanded((e) => ({ ...e, [s.sku]: !e[s.sku] }))} className="text-muted-foreground hover:text-foreground">
                                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{s.sku}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{s.brand_name ?? "—"}<div className="text-[10px] opacity-70">{eff.groupName}</div></TableCell>
                          <TableCell className="text-right tabular-nums">{num(s.units_per_wk).toFixed(1)}</TableCell>
                          <TableCell className="text-right tabular-nums whitespace-nowrap">
                            {gbp(s.avg_price_inc)}
                            {num(s.max_price_inc) - num(s.min_price_inc) > 0.05 && <div className="text-[10px] text-muted-foreground">{s.stores}× · {gbp(s.min_price_inc)}–{gbp(s.max_price_inc)}</div>}
                          </TableCell>
                          <TableCell className="text-right"><Badge variant="outline" className={`${tierTone(s.tier)} text-[11px] capitalize`}>{s.tier} · {num(s.cur_por).toFixed(0)}%</Badge></TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{s.pack_count > 0 ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Layers className="h-3 w-3" />{s.pack_count}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>
                            <Select value={eff.single} onValueChange={(v) => setOverride((o) => ({ ...o, [s.sku]: { ...o[s.sku], single: v } }))}>
                              <SelectTrigger className="h-8 w-[110px] text-xs capitalize"><SelectValue /></SelectTrigger>
                              <SelectContent>{TIER_OPTS.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {s.pack_count > 0 ? (
                              <Select value={eff.pack} onValueChange={(v) => setOverride((o) => ({ ...o, [s.sku]: { ...o[s.sku], pack: v } }))}>
                                <SelectTrigger className="h-8 w-[110px] text-xs capitalize"><SelectValue /></SelectTrigger>
                                <SelectContent>{TIER_OPTS.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                              </Select>
                            ) : <span className="text-xs text-muted-foreground">no packs</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" disabled={busySku === s.sku} onClick={() => testMutation.mutate(s)} title="Derive the family, snap to charm, push atom + all −Q to every eBay store, and track">
                              {busySku === s.sku ? <Loader2 className="h-3 w-3 animate-spin" /> : <><FlaskConical className="h-3 w-3 mr-1" /> Test &amp; Track</>}
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isOpen && <FamilyPreview sku={s.sku} single={eff.single} pack={eff.pack} />}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FamilyPreview({ sku, single, pack }: { sku: string; single: string; pack: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["elasticity_family", sku, single, pack],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_elasticity_family", { p_sku: sku, p_single_tier: single, p_pack_tier: pack });
      if (error) throw error;
      return (data ?? []) as FamilyRow[];
    },
  });
  return (
    <TableRow>
      <TableCell colSpan={10} className="bg-muted/30 p-0">
        <div className="px-10 py-3">
          <div className="text-xs text-muted-foreground mb-2">Derived family — single → <span className="capitalize font-medium">{single}</span>, packs → <span className="capitalize font-medium">{pack}</span> (snapped to charm)</div>
          {isLoading ? <Skeleton className="h-16 w-full" /> : (
            <div className="flex flex-wrap gap-2">
              {(data ?? []).map((f) => (
                <div key={f.tier_sku} className="rounded border bg-card px-2.5 py-1.5 text-xs">
                  <div className="font-mono text-[11px]">{f.tier_sku}</div>
                  <div className="tabular-nums"><span className="font-medium">{gbp(f.price)}</span> <span className="text-muted-foreground">· {gbp(f.per_unit)}/u · {num(f.por).toFixed(0)}%</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ElasticityRules() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [winDraft, setWinDraft] = useState<WindowCfg | null>(null);

  const { data: groups } = useQuery({
    queryKey: ["rules_groups_edit"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("elasticity_rule_groups").select("*").order("sort_order");
      return (data ?? []) as (RuleGroup & { sort_order: number })[];
    },
  });
  const { data: brandRows } = useQuery({
    queryKey: ["rules_brand_density"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("get_brand_q_density");
      return (data ?? []) as { brand_code: string; q_listings: number; atom_listings: number; q_pct: number; group_id: string | null }[];
    },
  });
  const { data: windowCfg } = useQuery({
    queryKey: ["rules_window"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("app_settings").select("value").eq("key", "elasticity.sellers_window").maybeSingle();
      return (data?.value ?? { day: 5, start_hour: 9, duration_hours: 24 }) as WindowCfg;
    },
  });

  const saveGroup = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: "single_tier" | "pack_tier"; value: string }) => {
      const { error } = await (supabase as any).from("elasticity_rule_groups").update({ [field]: value }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rules_groups_edit"] }); qc.invalidateQueries({ queryKey: ["elasticity_rule_groups"] }); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  const saveBrand = useMutation({
    mutationFn: async ({ brand_code, group_id }: { brand_code: string; group_id: string }) => {
      const { error } = await (supabase as any).from("brand_rule_group").upsert({ brand_code, group_id }, { onConflict: "brand_code" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules_brand_density"] }),
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  const saveWindow = useMutation({
    mutationFn: async (cfg: WindowCfg) => {
      const { error } = await (supabase as any).from("app_settings").update({ value: { day: cfg.day, start_hour: cfg.start_hour, duration_hours: cfg.duration_hours, open_until: cfg.open_until ?? null } }).eq("key", "elasticity.sellers_window");
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast({ title: "Window saved" }); qc.invalidateQueries({ queryKey: ["rules_window"] }); qc.invalidateQueries({ queryKey: ["elasticity_sellers_window"] }); setWinDraft(null); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const w = winDraft ?? windowCfg ?? { day: 5, start_hour: 9, duration_hours: 24 };
  const setW = (patch: Partial<WindowCfg>) => setWinDraft({ ...(winDraft ?? windowCfg ?? { day: 5, start_hour: 9, duration_hours: 24 }), ...patch });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Rule groups</CardTitle><CardDescription>The Single and Pack tier each group aims for. Editing here moves every brand in the group at once, and pre-fills the Sellers dropdowns.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Group</TableHead><TableHead>Single →</TableHead><TableHead>Packs →</TableHead></TableRow></TableHeader>
            <TableBody>
              {(groups ?? []).map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell>
                    <Select value={g.single_tier} onValueChange={(v) => saveGroup.mutate({ id: g.id, field: "single_tier", value: v })}>
                      <SelectTrigger className="h-8 w-[120px] text-xs capitalize"><SelectValue /></SelectTrigger>
                      <SelectContent>{TIER_OPTS.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={g.pack_tier} onValueChange={(v) => saveGroup.mutate({ id: g.id, field: "pack_tier", value: v })}>
                      <SelectTrigger className="h-8 w-[120px] text-xs capitalize"><SelectValue /></SelectTrigger>
                      <SelectContent>{TIER_OPTS.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Sellers launch window</CardTitle><CardDescription>When new tests can be launched (UK time). Live tests stay viewable any day.</CardDescription></CardHeader>
        <CardContent className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Day</span>
            <Select value={String(w.day)} onValueChange={(v) => setW({ day: Number(v) })}>
              <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Opens (hour)</span><Input type="number" min={0} max={23} value={w.start_hour} onChange={(e) => setW({ start_hour: Number(e.target.value) })} className="h-9 w-20" /></div>
          <div className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Open for (hours)</span><Input type="number" min={1} max={168} value={w.duration_hours} onChange={(e) => setW({ duration_hours: Number(e.target.value) })} className="h-9 w-20" /></div>
          <Button size="sm" disabled={!winDraft || saveWindow.isPending} onClick={() => saveWindow.mutate(w)}><Save className="h-3 w-3 mr-1" /> Save</Button>
          {windowCfg?.open_until && new Date() < new Date(windowCfg.open_until) && (
            <div className="text-xs text-muted-foreground ml-auto flex items-center gap-2">
              One-off open until {new Date(windowCfg.open_until).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit" })}
              <button className="underline" onClick={() => saveWindow.mutate({ ...w, open_until: null })}>clear</button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Brand assignments</CardTitle><CardDescription>Every brand with Q-codes, its listing density, and its group. Assign the ones that matter — unassigned brands default to “Some Q”.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <div className="rounded-md border-t [&>div]:max-h-[60vh] [&>div]:overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow><TableHead>Brand</TableHead><TableHead className="text-right">Q listings</TableHead><TableHead className="text-right">% Q</TableHead><TableHead>Group</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(brandRows ?? []).map((b) => (
                  <TableRow key={b.brand_code}>
                    <TableCell className="font-mono text-xs">{b.brand_code}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{b.q_listings}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{num(b.q_pct).toFixed(0)}%</TableCell>
                    <TableCell>
                      <Select value={b.group_id ?? ""} onValueChange={(v) => saveBrand.mutate({ brand_code: b.brand_code, group_id: v })}>
                        <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="— unassigned —" /></SelectTrigger>
                        <SelectContent>{(groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface TestRow {
  id: string; sku: string; brand_name: string | null; target_tier: string;
  baseline_price_inc: number; test_price_inc: number; change_pct: number | null; stores_pushed: number;
  status: string; started_at: string;
  baseline_units_wk: number | null; recent_units_wk: number; units_change_pct: number | null;
  baseline_profit_wk: number | null; recent_profit_wk: number; profit_change_pct: number | null;
  complete_weeks: number; maturity: string; disrupted: boolean;
}

function TestsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["elasticity_tests_tracking"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_elasticity_tests", { p_include_closed: false });
      if (error) throw error;
      return (data ?? []) as TestRow[];
    },
  });
  const { data: ebayStores } = useQuery({
    queryKey: ["ebay-stores-enabled"],
    queryFn: async () => {
      const { data } = await supabase.from("threeds_stores").select("id, store_name, mintsoft_channel, enabled").eq("enabled", true);
      return (data ?? []).filter((s: any) => (s.mintsoft_channel ?? "").toLowerCase().startsWith("ebay"));
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ t, status }: { t: TestRow; status: "kept" | "reverted" }) => {
      if (status === "reverted") {
        for (const st of ebayStores ?? []) {
          await supabase.functions.invoke("threeds-reprice-push", { body: { store_id: st.id, source: "elasticity", rows: [{ sku: t.sku, new_price: Number(num(t.baseline_price_inc).toFixed(2)) }] } });
        }
      }
      const patch: Record<string, unknown> = { status };
      if (status === "reverted") patch.reverted_at = new Date().toISOString();
      const { error } = await (supabase as any).from("elasticity_tests").update(patch).eq("id", t.id);
      if (error) throw new Error(error.message);
      return { t, status };
    },
    onSuccess: ({ t, status }) => {
      toast({ title: status === "reverted" ? "Reverted" : "Kept", description: status === "reverted" ? `${t.sku} atom queued back to ${gbp(t.baseline_price_inc)} across all eBay stores.` : `${t.sku} kept — stopped tracking.` });
      qc.invalidateQueries({ queryKey: ["elasticity_tests_tracking"] });
      qc.invalidateQueries({ queryKey: ["elasticity_active_test_skus"] }); // line returns to Sellers
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const busy = setStatus.isPending;
  const rows = data ?? [];

  const deltaCell = (was: number | null, now: number, pct: number | null, money = false) => {
    if (was == null) return <span className="text-muted-foreground text-xs">—</span>;
    return (
      <span className="whitespace-nowrap tabular-nums">
        {money ? gbp(was) : was.toFixed(1)} <span className="text-muted-foreground">→</span> {money ? gbp(now) : now.toFixed(1)}
        {pct != null && <span className={`ml-1 text-xs ${pct >= 0 ? "text-band-good" : "text-warning"}`}>{pct >= 0 ? "+" : ""}{pct}%</span>}
      </span>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Live elasticity tests</CardTitle>
        <CardDescription>
          Combined weekly units (atom-equivalent — a −Q04 sale counts as 4) &amp; contribution across all eBay stores and the whole
          family since each test went live. Measurement starts the first full week; ⚠ holds off until 2 weeks.
          <strong> Contribution /wk</strong> is the verdict. Revert queues the atom’s old price back to every store.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {isLoading ? <Skeleton className="h-40 w-full" /> : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No live tests yet — start one from the <strong>Sellers</strong> tab.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Single / Pack</TableHead>
                <TableHead className="text-right">Atom baseline → test</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Units /wk</TableHead>
                <TableHead className="text-right">Contribution /wk</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id} className={t.disrupted ? "bg-destructive/5" : ""}>
                  <TableCell className="font-mono text-xs">{t.sku}<div className="text-[10px] text-muted-foreground">{t.brand_name}</div></TableCell>
                  <TableCell><Badge variant="outline" className="text-[11px] capitalize">{t.target_tier}</Badge></TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {gbp(t.baseline_price_inc)} <ArrowRight className="inline h-3 w-3 text-muted-foreground" /> <span className="font-medium">{gbp(t.test_price_inc)}</span>
                    <div className="text-[10px] text-muted-foreground">{t.stores_pushed} stores</div>
                  </TableCell>
                  <TableCell>
                    {t.disrupted ? <Badge variant="secondary" className="border-destructive/50 bg-destructive/15 text-destructive text-[11px]">⚠ disrupted</Badge>
                      : t.maturity === "settling" ? <span className="text-[11px] text-muted-foreground">settling</span>
                      : t.maturity === "early" ? <Badge variant="secondary" className="text-[11px]">wk 1 · early</Badge>
                      : <Badge variant="secondary" className="border-band-good/40 bg-band-good/10 text-band-good text-[11px]">measuring · {t.complete_weeks}w</Badge>}
                  </TableCell>
                  <TableCell className="text-right">{deltaCell(t.baseline_units_wk, t.recent_units_wk, t.units_change_pct)}</TableCell>
                  <TableCell className="text-right">{deltaCell(t.baseline_profit_wk, t.recent_profit_wk, t.profit_change_pct, true)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="mr-1" disabled={busy} onClick={() => setStatus.mutate({ t, status: "kept" })}>Keep</Button>
                    <Button size="sm" variant={t.disrupted ? "default" : "outline"} disabled={busy} onClick={() => setStatus.mutate({ t, status: "reverted" })}>
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RotateCcw className="h-3 w-3 mr-1" /> Revert</>}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
