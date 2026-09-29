-- Elasticity shadow proposer — table + RPC.
-- Captures into the repo what is already LIVE in the database (applied earlier via MCP,
-- per project convention). Idempotent and non-destructive: safe to (re)run.
-- Table `elasticity_proposals` is read by src/components/intelligence/ElasticityProposals.tsx;
-- `run_elasticity_proposer()` is driven weekly by cron job 87 (run-elasticity-proposer-weekly).

create table if not exists public.elasticity_proposals (
  id                  uuid primary key default gen_random_uuid(),
  sku                 text,
  channel_group       text,
  iso_year            integer,
  iso_week            integer,
  current_price       numeric,
  proposed_price      numeric,
  step_pct_effective  numeric,
  projected_por_pct   numeric,
  projected_profit_wk numeric,
  baseline_profit_wk  numeric,
  floor               numeric,
  weekly_units        numeric,
  action              text,
  reason              text,
  created_at          timestamptz default now(),
  brand_name          text
);

create unique index if not exists elasticity_proposals_sku_channel_group_iso_year_iso_week_key
  on public.elasticity_proposals (sku, channel_group, iso_year, iso_week);

alter table public.elasticity_proposals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.elasticity_proposals'::regclass
      and polname = 'elasticity_proposals_authenticated_all'
  ) then
    create policy elasticity_proposals_authenticated_all
      on public.elasticity_proposals for all to authenticated
      using (true) with check (true);
  end if;
end $$;

grant select, insert, update, delete on public.elasticity_proposals to authenticated, service_role;

-- Proposer RPC (verbatim as live). Proposes gentle charm-ladder step-ups on ALREADY-PROFITABLE
-- lines only (losers are the repricer's job); excludes on-campaign weeks and OOS weeks, honours
-- max drift + stellar ceiling. SECURITY DEFINER; called with p_persist=true by the weekly cron.
CREATE OR REPLACE FUNCTION public.run_elasticity_proposer(p_persist boolean DEFAULT true)
 RETURNS TABLE(action text, n bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year int; v_week int;
  v_step numeric; v_min_units numeric; v_max_drift numeric; v_stellar numeric; v_breakeven numeric;
BEGIN
  SELECT extract(isoyear FROM d)::int, extract(week FROM d)::int INTO v_year, v_week
  FROM (SELECT (date_trunc('week', current_date)::date - 1) AS d) t;
  v_step      := coalesce((SELECT value::numeric FROM app_settings WHERE key='elasticity.step_pct'),0.025);
  v_min_units := coalesce((SELECT value::numeric FROM app_settings WHERE key='elasticity.min_units_per_week'),4);
  v_max_drift := coalesce((SELECT value::numeric FROM app_settings WHERE key='elasticity.max_drift_pct'),0.30);
  v_stellar   := coalesce((SELECT (value->>'amazing_max')::numeric FROM app_settings WHERE key='profit.loss_bands'),49.99) + 2.5;
  v_breakeven := coalesce((SELECT (value->>'breakeven_max')::numeric FROM app_settings WHERE key='profit.loss_bands'),1.0);

  IF p_persist THEN
  INSERT INTO elasticity_proposals (sku, channel_group, iso_year, iso_week, current_price, proposed_price,
    step_pct_effective, projected_por_pct, projected_profit_wk, baseline_profit_wk, floor, weekly_units, action, reason)
  WITH stock_wk AS (
    SELECT sku, extract(isoyear FROM snapshot_date)::int yr, extract(week FROM snapshot_date)::int wk, max(on_hand) moh
    FROM stock_snapshot WHERE snapshot_date >= current_date - 70 GROUP BY 1,2,3
  ),
  unit AS (
    SELECT ew.sku,
      CASE WHEN lower(ew.channel) LIKE 'ebay%' THEN 'ebay' WHEN lower(ew.channel) LIKE 'amazon%' THEN 'amazon' ELSE 'other' END cg,
      sum(ew.units) units, sum(ew.profit) profit, sum(ew.revenue) revenue,
      sum(ew.units*ew.avg_cost)/nullif(sum(ew.units),0) avg_cost,
      count(DISTINCT (ew.iso_year, ew.iso_week)) weeks
    FROM elasticity_weekly ew
    LEFT JOIN stock_wk s ON s.sku=ew.sku AND s.yr=ew.iso_year AND s.wk=ew.iso_week
    WHERE ew.week_start >= current_date - 56 AND ew.week_start < date_trunc('week', current_date)
      AND ew.on_campaign = false AND coalesce(s.moh, 1) > 0
    GROUP BY 1,2
  ),
  cand AS (
    SELECT u.sku, u.cg, u.profit/nullif(u.units,0) profit_pu, u.revenue/nullif(u.units,0) price_cur,
      u.units/nullif(u.weeks,0)::numeric units_wk,
      (1.0/1.2 - CASE WHEN u.cg='amazon' THEN 0.15 ELSE 0.12 END) marg
    FROM unit u
    WHERE u.cg IN ('ebay','amazon') AND u.avg_cost > 0
      AND u.units/nullif(u.weeks,0) >= v_min_units AND u.revenue/nullif(u.units,0) > 0
  ),
  gated AS (
    SELECT c.* FROM cand c
    WHERE c.profit_pu > c.price_cur * v_breakeven/100     -- profitable only (POR > breakeven); losers are the repricer's job
      AND NOT EXISTS (SELECT 1 FROM price_campaigns pc WHERE pc.sku=c.sku AND pc.status='active' AND pc.type IN ('liquidation','sale','promo'))
      AND (c.cg <> 'amazon' OR EXISTS (SELECT 1 FROM v_esagu_buybox b WHERE b.catalogue_sku=c.sku AND (b.competable_price IS NULL OR b.is_our_buybox)))
  ),
  calc AS (
    SELECT g.*, round(g.price_cur - g.profit_pu/nullif(g.marg,0),2) AS floor,
      g.profit_pu/nullif(g.price_cur,0)*100 AS cur_por,
      round(g.price_cur*(1+v_max_drift),2) AS drift_cap,
      public.charm_snap_up(round(g.price_cur*(1+v_step),2)) AS snap
    FROM gated g
  ),
  decided AS (
    SELECT c.*,
      CASE WHEN c.cur_por >= v_stellar THEN c.price_cur
           WHEN c.snap IS NULL OR c.snap > c.drift_cap OR c.snap <= c.price_cur THEN c.price_cur ELSE c.snap END AS px,
      CASE WHEN c.cur_por >= v_stellar THEN 'lock'
           WHEN c.snap IS NULL OR c.snap > c.drift_cap OR c.snap <= c.price_cur THEN 'hold'
           WHEN (c.profit_pu + (c.snap-c.price_cur)*c.marg)/c.snap*100 >= v_stellar THEN 'lock'
           ELSE 'propose_step' END AS act,
      CASE WHEN c.cur_por >= v_stellar THEN 'already_stellar'
           WHEN c.snap IS NULL THEN 'above_ladder' WHEN c.snap > c.drift_cap THEN 'max_drift_cap' WHEN c.snap <= c.price_cur THEN 'no_headroom'
           WHEN (c.profit_pu + (c.snap-c.price_cur)*c.marg)/c.snap*100 >= v_stellar THEN 'stellar_ceiling'
           ELSE 'step_up' END AS rsn
    FROM calc c
  )
  SELECT d.sku, d.cg, v_year, v_week, round(d.price_cur,2), round(d.px,2),
    round(CASE WHEN d.px=d.price_cur THEN 0 ELSE (d.px-d.price_cur)/d.price_cur*100 END,1),
    round((d.profit_pu + (d.px-d.price_cur)*d.marg)/nullif(d.px,0)*100,1),
    round((d.profit_pu + (d.px-d.price_cur)*d.marg)*d.units_wk,2),
    round(d.profit_pu*d.units_wk,2), d.floor, round(d.units_wk,2), d.act, d.rsn
  FROM decided d
  ON CONFLICT (sku, channel_group, iso_year, iso_week) DO UPDATE SET
    current_price=excluded.current_price, proposed_price=excluded.proposed_price, step_pct_effective=excluded.step_pct_effective,
    projected_por_pct=excluded.projected_por_pct, projected_profit_wk=excluded.projected_profit_wk,
    baseline_profit_wk=excluded.baseline_profit_wk, floor=excluded.floor, weekly_units=excluded.weekly_units,
    action=excluded.action, reason=excluded.reason, created_at=now();
  END IF;

  -- clear stale rows for this week that no longer qualify (dropped candidates)
  DELETE FROM public.elasticity_proposals ep WHERE ep.iso_year=v_year AND ep.iso_week=v_week AND ep.created_at < now() - interval '1 minute';

  RETURN QUERY SELECT ep.action, count(*) FROM public.elasticity_proposals ep
  WHERE ep.iso_year=v_year AND ep.iso_week=v_week GROUP BY ep.action ORDER BY 2 DESC;
END $function$;
