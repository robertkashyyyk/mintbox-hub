import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface FeeRule {
  id: string;
  name: string;
  channel_pattern: string;
  vat_rate: number;
  fee_pct: number;
  fixed_fee: number;
  priority: number;
  active: boolean;
  notes: string | null;
}

interface CourierRate {
  id: string;
  courier: string;
  service: string;
  cost: number;
  active: boolean;
  notes: string | null;
}

const ProfitRules = () => {
  const qc = useQueryClient();

  const { data: rules, isLoading: loadingRules } = useQuery({
    queryKey: ["channel-fee-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_fee_rules")
        .select("*")
        .order("priority")
        .order("name");
      if (error) throw error;
      return data as FeeRule[];
    },
  });

  const { data: rates, isLoading: loadingRates } = useQuery({
    queryKey: ["courier-rates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courier_rates")
        .select("*")
        .order("courier")
        .order("service");
      if (error) throw error;
      return data as CourierRate[];
    },
  });

  const refreshRules = () => qc.invalidateQueries({ queryKey: ["channel-fee-rules"] });
  const refreshRates = () => qc.invalidateQueries({ queryKey: ["courier-rates"] });

  const updateRule = async (id: string, patch: Partial<FeeRule>) => {
    const { error } = await supabase.from("channel_fee_rules").update(patch).eq("id", id);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Rule saved" }); refreshRules(); }
  };

  const updateRate = async (id: string, patch: Partial<CourierRate>) => {
    const { error } = await supabase.from("courier_rates").update(patch).eq("id", id);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Rate saved" }); refreshRates(); }
  };

  const addRule = async () => {
    const { error } = await supabase.from("channel_fee_rules").insert({
      name: "New rule", channel_pattern: "%", fee_pct: 0, fixed_fee: 0, priority: 999, active: false,
    });
    if (error) toast({ title: "Add failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Rule added" }); refreshRules(); }
  };

  const addRate = async () => {
    const { error } = await supabase.from("courier_rates").insert({
      courier: "New", service: "service", cost: 0, active: false,
    });
    if (error) toast({ title: "Add failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Rate added" }); refreshRates(); }
  };

  const deleteRule = async (id: string) => {
    const { error } = await supabase.from("channel_fee_rules").delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Rule removed" }); refreshRules(); }
  };

  const deleteRate = async (id: string) => {
    const { error } = await supabase.from("courier_rates").delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Rate removed" }); refreshRates(); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Settings className="h-6 w-6 text-pd-accent" />
          Profit Rules
        </h1>
        <p className="text-sm text-foreground/60 mt-1">
          Channel fee formulas and courier costs used by the Profit Intelligence dashboard.
        </p>
      </div>

      {/* Channel Fee Rules */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">Channel fee rules</CardTitle>
            <CardDescription>
              Lowest priority wins first match. Pattern uses SQL <code>LIKE</code> — e.g. <code>Ama%</code> for Amazon, <code>%</code> as fallback.
              Fee = order GMV (inc VAT) × fee% + fixed fee.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={addRule}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </CardHeader>
        <CardContent>
          {loadingRules ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Pattern</TableHead>
                    <TableHead className="w-24">Fee %</TableHead>
                    <TableHead className="w-24">Fixed £</TableHead>
                    <TableHead className="w-24">VAT</TableHead>
                    <TableHead className="w-20">Priority</TableHead>
                    <TableHead className="w-20">Active</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rules ?? []).map((r) => <RuleRow key={r.id} rule={r} onSave={updateRule} onDelete={deleteRule} />)}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Courier Rates */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">Courier rates</CardTitle>
            <CardDescription>Fixed cost per shipment by courier service. Matches against <code>order_lines.courier_service</code>.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={addRate}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </CardHeader>
        <CardContent>
          {loadingRates ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Courier</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead className="w-32">Cost £</TableHead>
                    <TableHead className="w-20">Active</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rates ?? []).map((r) => <RateRow key={r.id} rate={r} onSave={updateRate} onDelete={deleteRate} />)}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <LossBandsCard />
    </div>
  );
};

interface LossBands {
  mode?: string;
  loss_max: number;       // POR % below this = Loss
  breakeven_max: number;  // up to this = Breakeven
  poor_max: number;       // up to this = Poor
  average_max: number;    // up to this = Average
  good_max: number;       // up to this = Good
  great_max: number;      // up to this = Great; above = Amazing
}

const BAND_FIELDS: { key: keyof LossBands; label: string; hint: string }[] = [
  { key: "loss_max",      label: "Loss <",         hint: "POR % below this is a Loss" },
  { key: "breakeven_max", label: "Breakeven ≤",    hint: "Up to this POR % is Breakeven" },
  { key: "poor_max",      label: "Poor ≤",         hint: "Up to this POR % is Poor" },
  { key: "average_max",   label: "Average ≤",      hint: "Up to this POR % is Average" },
  { key: "good_max",      label: "Good ≤",         hint: "Up to this POR % is Good" },
  { key: "great_max",     label: "Great ≤",        hint: "Up to this POR % is Great; above is Amazing" },
];

const LossBandsCard = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["loss-bands"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "profit.loss_bands")
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? { mode: "pct", loss_max: -1, breakeven_max: 1, poor_max: 9.99, average_max: 19.99, good_max: 24.99, great_max: 29.99 }) as unknown as LossBands;
    },
  });

  const [draft, setDraft] = useState<LossBands | null>(null);
  const current = draft ?? data ?? null;
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(data);

  const save = async () => {
    if (!current) return;
    const { error } = await supabase
      .from("app_settings")
      .update({ value: current as any })
      .eq("key", "profit.loss_bands");
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Loss bands saved" }); qc.invalidateQueries({ queryKey: ["loss-bands"] }); setDraft(null); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base">Loss / profit bands</CardTitle>
          <CardDescription>
            Per-line profit £ thresholds used by the segmentation card on the Profit dashboard. Buckets: Big loss &lt; big_loss_max, Small loss ≤ small_loss_max, Breakeven ≤ breakeven_max, Small profit ≤ small_profit_max, otherwise Big profit.
          </CardDescription>
        </div>
        <Button size="sm" disabled={!dirty} onClick={save}><Save className="h-4 w-4 mr-1" />Save</Button>
      </CardHeader>
      <CardContent>
        {isLoading || !current ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["big_loss_max", "small_loss_max", "breakeven_max", "small_profit_max"] as const).map((k) => (
              <label key={k} className="text-xs text-foreground/70 space-y-1">
                <span className="block font-medium">{k.replace(/_/g, " ")}</span>
                <Input
                  type="number"
                  step="0.01"
                  value={current[k]}
                  onChange={(e) => setDraft({ ...current, [k]: Number(e.target.value) })}
                  className="h-8"
                />
              </label>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const RuleRow = ({ rule, onSave, onDelete }: { rule: FeeRule; onSave: (id: string, patch: Partial<FeeRule>) => void; onDelete: (id: string) => void }) => {
  const [draft, setDraft] = useState(rule);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rule);
  return (
    <TableRow>
      <TableCell><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="h-8" /></TableCell>
      <TableCell><Input value={draft.channel_pattern} onChange={(e) => setDraft({ ...draft, channel_pattern: e.target.value })} className="h-8 font-mono" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={draft.fee_pct} onChange={(e) => setDraft({ ...draft, fee_pct: Number(e.target.value) })} className="h-8" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={draft.fixed_fee} onChange={(e) => setDraft({ ...draft, fixed_fee: Number(e.target.value) })} className="h-8" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={draft.vat_rate} onChange={(e) => setDraft({ ...draft, vat_rate: Number(e.target.value) })} className="h-8" /></TableCell>
      <TableCell><Input type="number" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} className="h-8" /></TableCell>
      <TableCell><Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} /></TableCell>
      <TableCell className="space-x-1">
        <Button size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty} onClick={() => onSave(rule.id, draft)}>
          <Save className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(rule.id)}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
};

const RateRow = ({ rate, onSave, onDelete }: { rate: CourierRate; onSave: (id: string, patch: Partial<CourierRate>) => void; onDelete: (id: string) => void }) => {
  const [draft, setDraft] = useState(rate);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rate);
  return (
    <TableRow>
      <TableCell><Input value={draft.courier} onChange={(e) => setDraft({ ...draft, courier: e.target.value })} className="h-8" /></TableCell>
      <TableCell><Input value={draft.service} onChange={(e) => setDraft({ ...draft, service: e.target.value })} className="h-8 font-mono" /></TableCell>
      <TableCell><Input type="number" step="0.01" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: Number(e.target.value) })} className="h-8" /></TableCell>
      <TableCell><Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} /></TableCell>
      <TableCell className="space-x-1">
        <Button size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty} onClick={() => onSave(rate.id, draft)}>
          <Save className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(rate.id)}>
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
};

export default ProfitRules;
