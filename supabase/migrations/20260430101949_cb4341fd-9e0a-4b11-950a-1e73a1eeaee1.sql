-- ============================================================
-- Migration 003 (Option A): Purchasing tables — safe version
-- ============================================================

-- ── suppliers (mirror of brands.id) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
  id               uuid PRIMARY KEY,
  name             text NOT NULL,
  contact_email    text,
  contact_name     text,
  contact_phone    text,
  ordering_method  text CHECK (ordering_method IN ('email','portal','api','manual')) DEFAULT 'email',
  active           boolean DEFAULT true,
  notes            text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

INSERT INTO public.suppliers (id, name, active)
SELECT id, name, true FROM public.brands
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ── sku_prefixes (seeded from brands.prefix) ────────────────
CREATE TABLE IF NOT EXISTS public.sku_prefixes (
  prefix       text PRIMARY KEY,
  supplier_id  uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  prefix_style text CHECK (prefix_style IN ('hyphen','slash')) DEFAULT 'hyphen',
  notes        text
);

INSERT INTO public.sku_prefixes (prefix, supplier_id, prefix_style)
SELECT upper(prefix), id, prefix_style::text
FROM public.brands
WHERE prefix IS NOT NULL AND length(trim(prefix)) > 0
ON CONFLICT (prefix) DO UPDATE
  SET supplier_id  = EXCLUDED.supplier_id,
      prefix_style = EXCLUDED.prefix_style;

-- ── open_asns ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.open_asns (
  id                 integer PRIMARY KEY,
  po_reference       text,
  supplier_name      text,
  supplier_id        uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  warehouse_id       integer,
  estimated_delivery date,
  asn_status         text,
  booked_in_date     timestamptz,
  synced_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.open_asn_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asn_id              integer NOT NULL REFERENCES public.open_asns(id) ON DELETE CASCADE,
  sku                 text NOT NULL,
  mintsoft_product_id integer,
  expected_qty        integer DEFAULT 0,
  received_qty        integer DEFAULT 0,
  synced_at           timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS open_asn_items_sku_idx ON public.open_asn_items(sku);
CREATE INDEX IF NOT EXISTS open_asn_items_asn_idx ON public.open_asn_items(asn_id);

-- ── purchase_orders ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status      text DEFAULT 'draft'
              CHECK (status IN ('draft','approved','sent','partial','complete','cancelled')),
  notes       text,
  created_by  uuid,
  approved_by uuid,
  approved_at timestamptz,
  sent_at     timestamptz,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id           uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  sku             text NOT NULL,
  product_name    text,
  qty_ordered     integer NOT NULL DEFAULT 0,
  unit_cost       numeric(10,2),
  mintsoft_asn_id integer,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_order_lines_po_idx ON public.purchase_order_lines(po_id);

-- ── agent_runs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type    text NOT NULL,
  status      text DEFAULT 'running' CHECK (status IN ('running','complete','error')),
  summary     jsonb,
  error       text,
  started_at  timestamptz DEFAULT now(),
  finished_at timestamptz
);

-- ── purchasing_requirements view (handles hyphen + slash) ──
DROP VIEW IF EXISTS public.purchasing_requirements;
CREATE VIEW public.purchasing_requirements
WITH (security_invoker = true) AS
SELECT
  pc.sku,
  pc.name,
  pc.current_stock::integer                         AS current_stock,
  pc.low_stock_alert_level::integer                 AS lsa,
  pc.back_order_qty::integer                        AS back_order_qty,
  pc.on_order::integer                              AS on_order_qty,
  pc.cost_price,
  pc.brand_id                                       AS supplier_id,
  s.name                                            AS supplier_name,
  sp.prefix,
  GREATEST(
    0,
    (pc.low_stock_alert_level * 2)::integer
      - pc.current_stock::integer
      - COALESCE(pc.on_order, 0)::integer
  )::integer                                        AS reorder_qty,
  COALESCE((
    SELECT SUM(oi.expected_qty)::integer
    FROM public.open_asn_items oi
    WHERE oi.sku = pc.sku
  ), 0)                                             AS open_asn_qty
FROM public.products_cache pc
LEFT JOIN public.sku_prefixes sp
  ON sp.prefix = upper(
       split_part(pc.sku, CASE WHEN pc.sku LIKE '%/%' THEN '/' ELSE '-' END, 1)
     )
LEFT JOIN public.suppliers s ON s.id = sp.supplier_id
WHERE COALESCE(pc.discontinued, false) = false
  AND pc.current_stock <= pc.low_stock_alert_level
  AND pc.low_stock_alert_level > 0;

-- ── supplier_order_summary view ────────────────────────────
DROP VIEW IF EXISTS public.supplier_order_summary;
CREATE VIEW public.supplier_order_summary
WITH (security_invoker = true) AS
SELECT
  r.supplier_id,
  r.supplier_name,
  COUNT(*)                          AS sku_count,
  SUM(r.reorder_qty)                AS total_units,
  SUM(r.reorder_qty * r.cost_price) AS estimated_cost
FROM public.purchasing_requirements r
WHERE r.reorder_qty > 0 AND r.supplier_id IS NOT NULL
GROUP BY r.supplier_id, r.supplier_name
ORDER BY estimated_cost DESC NULLS LAST;

-- ── RLS ────────────────────────────────────────────────────
ALTER TABLE public.suppliers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sku_prefixes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_asns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.open_asn_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs           ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user
CREATE POLICY "auth read suppliers"     ON public.suppliers            FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read sku_prefixes"  ON public.sku_prefixes         FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read open_asns"     ON public.open_asns            FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read open_asn_items"ON public.open_asn_items       FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read purchase_orders"      ON public.purchase_orders      FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read purchase_order_lines" ON public.purchase_order_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read agent_runs"    ON public.agent_runs           FOR SELECT TO authenticated USING (true);

-- Write: super_user or senior_user only
CREATE POLICY "staff write suppliers"            ON public.suppliers            FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
CREATE POLICY "staff write sku_prefixes"         ON public.sku_prefixes         FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
CREATE POLICY "staff write open_asns"            ON public.open_asns            FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
CREATE POLICY "staff write open_asn_items"       ON public.open_asn_items       FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
CREATE POLICY "staff write purchase_orders"      ON public.purchase_orders      FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
CREATE POLICY "staff write purchase_order_lines" ON public.purchase_order_lines FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
CREATE POLICY "staff write agent_runs"           ON public.agent_runs           FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));

-- Service role: full access for backend jobs
CREATE POLICY "service all suppliers"            ON public.suppliers            FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service all sku_prefixes"         ON public.sku_prefixes         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service all open_asns"            ON public.open_asns            FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service all open_asn_items"       ON public.open_asn_items       FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service all purchase_orders"      ON public.purchase_orders      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service all purchase_order_lines" ON public.purchase_order_lines FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service all agent_runs"           ON public.agent_runs           FOR ALL TO service_role USING (true) WITH CHECK (true);