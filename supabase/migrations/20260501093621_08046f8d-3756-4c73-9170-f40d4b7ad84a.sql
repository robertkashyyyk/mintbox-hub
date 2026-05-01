ALTER TABLE public.order_lines
  ADD COLUMN IF NOT EXISTS unit_price numeric,
  ADD COLUMN IF NOT EXISTS line_total numeric,
  ADD COLUMN IF NOT EXISTS discount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS courier_service text;

CREATE TABLE IF NOT EXISTS public.courier_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier text NOT NULL,
  service text NOT NULL UNIQUE,
  cost numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.courier_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read courier_rates" ON public.courier_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff write courier_rates" ON public.courier_rates FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]));
CREATE POLICY "service all courier_rates" ON public.courier_rates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_courier_rates_updated_at BEFORE UPDATE ON public.courier_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.courier_rates (courier, service, cost) VALUES
  ('Evri', 'Evri Standard', 2.8),
  ('Royal Mail', 'Royal Mail 48 (LL)', 1.5),
  ('Royal Mail', 'Royal Mail International Tracked - Large Letter (MTI)', 4.0),
  ('Royal Mail', 'Royal Mail International Tracked - Parcel (MP1)', 7.0),
  ('Fastway', 'Scurri - Fastway|YY - Local Parcel YY', 2.95),
  ('Fastway', 'Scurri - Fastway|WY - National Parcel WY', 3.95),
  ('DHL', 'DHL Ecom UK Next Day Address Only Signed', 5.5),
  ('Royal Mail', 'Royal Mail 48 Packet', 2.8),
  ('Royal Mail', 'Royal Mail International Business Large Letter (DG4)', 4.0),
  ('Royal Mail', 'Royal Mail 24 (LL)', 1.95),
  ('Royal Mail', 'Royal Mail 24 Packet', 3.5),
  ('Royal Mail', 'RM INTL Bus Mail Tracked Country Priced MTK', 7.0),
  ('Royal Mail', 'Royal Mail Tracked 48 - Letterbox', 1.65),
  ('Royal Mail', 'Royal Mail Tracked 48', 2.65),
  ('Royal Mail', 'Royal Mail Tracked 24', 3.4),
  ('Royal Mail', 'Royal Mail Tracked 24 - Letterbox', 2.1),
  ('DHL', 'DHL Ecom UK 48 Addr Or Neighbour Signed', 5.5),
  ('DHL', 'DHL International Express 12 Noon', 50.0),
  ('Fastway', 'Scurri - Fastway|LY - National Parcel LY', 3.95),
  ('DHL', 'DHL European Express (ECX)', 40.0),
  ('DHL', 'DHL WorldWide Express (WPX)', 70.0),
  ('Royal Mail', 'Royal Mail Special Delivery by 1PM', 7.95),
  ('Royal Mail', 'Royal Mail International Business Parcel (DE4)', 7.0),
  ('Other', 'Collection In Person', 0.0),
  ('DHL', 'DHL Ecom UK International', 10.0),
  ('DHL', 'DHL Economy Select European Road (ESU)', 20.0),
  ('DHL', 'DHL Economy ESI - DDP', 0.0)
ON CONFLICT (service) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.channel_fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel_pattern text NOT NULL,
  vat_rate numeric NOT NULL DEFAULT 0.20,
  fee_pct numeric NOT NULL DEFAULT 0,
  fixed_fee numeric NOT NULL DEFAULT 0,
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.channel_fee_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read channel_fee_rules" ON public.channel_fee_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff write channel_fee_rules" ON public.channel_fee_rules FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role]));
CREATE POLICY "service all channel_fee_rules" ON public.channel_fee_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_channel_fee_rules_updated_at BEFORE UPDATE ON public.channel_fee_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.channel_fee_rules (name, channel_pattern, vat_rate, fee_pct, fixed_fee, priority, notes) VALUES
  ('Amazon', 'Ama%', 0.20, 0.15, 0, 10, 'Fee = price * 1.2 * 15% * qty'),
  ('Default (eBay/other)', '%', 0.20, 0.12, 0.36, 100, 'Fee = 0.36 + (price * 1.2 * 12% * qty)');

CREATE TABLE IF NOT EXISTS public.profit_weekly_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iso_year integer NOT NULL,
  iso_week integer NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  revenue numeric NOT NULL DEFAULT 0,
  qty integer NOT NULL DEFAULT 0,
  order_count integer NOT NULL DEFAULT 0,
  line_count integer NOT NULL DEFAULT 0,
  courier_cost_total numeric NOT NULL DEFAULT 0,
  channel_fees_total numeric NOT NULL DEFAULT 0,
  cost_total numeric NOT NULL DEFAULT 0,
  profit numeric NOT NULL DEFAULT 0,
  por_pct numeric,
  aov numeric,
  aip numeric,
  appp numeric,
  appo numeric,
  good_count integer NOT NULL DEFAULT 0,
  dirt_count integer NOT NULL DEFAULT 0,
  missing_cost_count integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'live',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (iso_year, iso_week)
);
ALTER TABLE public.profit_weekly_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read profit_weekly_snapshots" ON public.profit_weekly_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all profit_weekly_snapshots" ON public.profit_weekly_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "super write profit_weekly_snapshots" ON public.profit_weekly_snapshots FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_user'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_user'::app_role));
CREATE TRIGGER trg_profit_weekly_snapshots_updated_at BEFORE UPDATE ON public.profit_weekly_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE VIEW public.order_line_economics
WITH (security_invoker = true) AS
WITH lines_priced AS (
  SELECT
    ol.*,
    COALESCE(ol.unit_price, 0) AS price,
    pc.cost_price AS cost_each,
    count(*) OVER (PARTITION BY ol.mintsoft_order_id) AS lines_in_order
  FROM public.order_lines ol
  LEFT JOIN public.products_cache pc ON pc.sku = ol.sku
  WHERE ol.order_date >= '2026-01-01'::timestamptz
),
courier_resolved AS (
  SELECT lp.*, COALESCE(cr.cost, 0) AS courier_full_cost, cr.courier
  FROM lines_priced lp
  LEFT JOIN public.courier_rates cr ON cr.service = lp.courier_service
),
fee_resolved AS (
  SELECT cr2.*, (
    SELECT row_to_json(r) FROM (
      SELECT vat_rate, fee_pct, fixed_fee, name
      FROM public.channel_fee_rules
      WHERE active = true AND COALESCE(cr2.channel,'') ILIKE channel_pattern
      ORDER BY priority ASC LIMIT 1
    ) r
  ) AS fee_rule_json
  FROM courier_resolved cr2
)
SELECT
  fr.id, fr.mintsoft_order_id, fr.line_index, fr.sku, fr.product_name, fr.brand_id,
  fr.qty, fr.price, fr.cost_each, fr.currency, fr.order_date, fr.channel,
  fr.courier_service, fr.courier, fr.order_status, fr.lines_in_order,
  ROUND((fr.courier_full_cost / GREATEST(fr.lines_in_order, 1))::numeric, 4) AS courier_cost,
  ROUND((
    COALESCE((fr.fee_rule_json->>'fixed_fee')::numeric, 0) +
    fr.price * (1 + COALESCE((fr.fee_rule_json->>'vat_rate')::numeric, 0.20)) *
    COALESCE((fr.fee_rule_json->>'fee_pct')::numeric, 0) * fr.qty
  )::numeric, 4) AS channel_fee,
  fr.fee_rule_json->>'name' AS fee_rule_name,
  ROUND((fr.price * fr.qty)::numeric, 4) AS order_value,
  ROUND((
    (fr.price - COALESCE(fr.cost_each, 0)) * fr.qty
    - (fr.courier_full_cost / GREATEST(fr.lines_in_order, 1))
    - (COALESCE((fr.fee_rule_json->>'fixed_fee')::numeric, 0) +
       fr.price * (1 + COALESCE((fr.fee_rule_json->>'vat_rate')::numeric, 0.20)) *
       COALESCE((fr.fee_rule_json->>'fee_pct')::numeric, 0) * fr.qty)
  )::numeric, 4) AS profit,
  CASE WHEN fr.price > 0 AND fr.qty > 0 THEN
    ROUND((
      ((fr.price - COALESCE(fr.cost_each, 0)) * fr.qty
        - (fr.courier_full_cost / GREATEST(fr.lines_in_order, 1))
        - (COALESCE((fr.fee_rule_json->>'fixed_fee')::numeric, 0) +
           fr.price * (1 + COALESCE((fr.fee_rule_json->>'vat_rate')::numeric, 0.20)) *
           COALESCE((fr.fee_rule_json->>'fee_pct')::numeric, 0) * fr.qty))
      / NULLIF(fr.price * fr.qty * (1 + COALESCE((fr.fee_rule_json->>'vat_rate')::numeric, 0.20)), 0)
    )::numeric, 6)
  ELSE NULL END AS por_pct,
  CASE WHEN length(fr.sku) >= 4 AND substring(fr.sku, 4, 1) IN ('-', '/') THEN 'Good' ELSE 'Dirt' END AS good_dirt,
  (fr.cost_each IS NULL OR fr.cost_each = 0) AS missing_cost,
  EXTRACT(ISOYEAR FROM fr.order_date)::int AS iso_year,
  EXTRACT(WEEK FROM fr.order_date)::int AS iso_week,
  date_trunc('week', fr.order_date)::date AS week_start
FROM fee_resolved fr;

CREATE OR REPLACE FUNCTION public.get_profit_week(p_iso_year integer, p_iso_week integer)
RETURNS TABLE (
  iso_year integer, iso_week integer, week_start date, week_end date,
  revenue numeric, qty bigint, order_count bigint, line_count bigint,
  courier_cost_total numeric, channel_fees_total numeric, cost_total numeric,
  profit numeric, por_pct numeric, aov numeric,
  good_count bigint, dirt_count bigint, missing_cost_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH src AS (
    SELECT * FROM public.order_line_economics
    WHERE iso_year = p_iso_year AND iso_week = p_iso_week
  )
  SELECT
    p_iso_year, p_iso_week,
    MIN(week_start), (MIN(week_start) + INTERVAL '6 days')::date,
    COALESCE(SUM(order_value), 0),
    COALESCE(SUM(qty), 0)::bigint,
    COUNT(DISTINCT mintsoft_order_id)::bigint,
    COUNT(*)::bigint,
    COALESCE(SUM(courier_cost), 0),
    COALESCE(SUM(channel_fee), 0),
    COALESCE(SUM(cost_each * qty), 0),
    COALESCE(SUM(profit), 0),
    CASE WHEN SUM(order_value * 1.2) > 0
      THEN ROUND((SUM(profit) / SUM(order_value * 1.2))::numeric, 6)
      ELSE NULL END,
    CASE WHEN COUNT(DISTINCT mintsoft_order_id) > 0
      THEN ROUND((SUM(order_value) / COUNT(DISTINCT mintsoft_order_id))::numeric, 4)
      ELSE NULL END,
    COUNT(*) FILTER (WHERE good_dirt = 'Good')::bigint,
    COUNT(*) FILTER (WHERE good_dirt = 'Dirt')::bigint,
    COUNT(*) FILTER (WHERE missing_cost)::bigint
  FROM src;
$$;