-- Weekly Missing-Cost worklist: a cron picks the top-N missing-cost SKUs by sales
-- velocity each Monday; staff enter cost + push to Mintsoft; items drop off as done.
-- (Applied live via MCP on build; kept here for version control. Idempotent.)

CREATE TABLE IF NOT EXISTS public.weekly_missing_cost_runs (
  week_start    date PRIMARY KEY,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  item_count    integer NOT NULL DEFAULT 0,
  email_sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.weekly_missing_cost_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start          date NOT NULL REFERENCES public.weekly_missing_cost_runs(week_start) ON DELETE CASCADE,
  rank                integer NOT NULL,
  sku                 text NOT NULL,
  name                text,
  brand_id            uuid,
  brand_name          text,
  mintsoft_product_id integer,
  velocity_per_week   numeric,
  units_sold_90d      integer,
  current_stock       integer,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  cost_entered        numeric,
  sent_at             timestamptz,
  sent_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_start, sku)
);

CREATE INDEX IF NOT EXISTS wmci_week_status_idx ON public.weekly_missing_cost_items (week_start, status);

ALTER TABLE public.weekly_missing_cost_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_missing_cost_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read weekly runs"  ON public.weekly_missing_cost_runs;
DROP POLICY IF EXISTS "auth read weekly items" ON public.weekly_missing_cost_items;
CREATE POLICY "auth read weekly runs"  ON public.weekly_missing_cost_runs  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth read weekly items" ON public.weekly_missing_cost_items FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.generate_weekly_missing_cost_list(p_limit integer DEFAULT 50)
RETURNS TABLE(week_start date, item_count integer, is_new boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _week date := date_trunc('week', (now() AT TIME ZONE 'Europe/London'))::date;  -- Monday
  _existing integer;
  _inserted integer := 0;
BEGIN
  SELECT r.item_count INTO _existing FROM public.weekly_missing_cost_runs r WHERE r.week_start = _week;
  IF _existing IS NOT NULL THEN
    RETURN QUERY SELECT _week, _existing, false; RETURN;
  END IF;

  INSERT INTO public.weekly_missing_cost_runs (week_start) VALUES (_week);

  INSERT INTO public.weekly_missing_cost_items
    (week_start, rank, sku, name, brand_id, brand_name, mintsoft_product_id,
     velocity_per_week, units_sold_90d, current_stock)
  SELECT _week,
         row_number() OVER (ORDER BY pc.velocity_per_week DESC NULLS LAST, pc.units_sold_90d DESC NULLS LAST, pc.sku),
         pc.sku, pc.name, pc.brand_id, b.name, pc.mintsoft_product_id,
         pc.velocity_per_week, pc.units_sold_90d, pc.current_stock
  FROM public.products_cache pc
  LEFT JOIN public.brands b ON b.id = pc.brand_id
  WHERE COALESCE(pc.cost_price, 0) <= 0
    AND COALESCE(pc.discontinued, false) = false
    AND COALESCE(pc.quarantined, false) = false
    AND pc.mintsoft_product_id IS NOT NULL
    AND COALESCE(pc.velocity_per_week, 0) > 0
  ORDER BY pc.velocity_per_week DESC NULLS LAST, pc.units_sold_90d DESC NULLS LAST, pc.sku
  LIMIT GREATEST(p_limit, 1);

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  UPDATE public.weekly_missing_cost_runs SET item_count = _inserted
   WHERE weekly_missing_cost_runs.week_start = _week;

  RETURN QUERY SELECT _week, _inserted, true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_weekly_missing_cost_list()
RETURNS TABLE(
  id uuid, week_start date, rank integer, sku text, name text,
  brand_id uuid, brand_name text, mintsoft_product_id integer,
  velocity_per_week numeric, units_sold_90d integer, current_stock integer,
  status text, cost_entered numeric, sent_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT i.id, i.week_start, i.rank, i.sku, i.name, i.brand_id, i.brand_name,
         i.mintsoft_product_id, i.velocity_per_week, i.units_sold_90d, i.current_stock,
         i.status, i.cost_entered, i.sent_at
  FROM public.weekly_missing_cost_items i
  WHERE i.week_start = (SELECT max(week_start) FROM public.weekly_missing_cost_runs)
  ORDER BY i.rank;
$$;

CREATE OR REPLACE FUNCTION public.mark_weekly_missing_cost_done(p_id uuid, p_cost numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.weekly_missing_cost_items
     SET status = 'done', cost_entered = p_cost, sent_at = now(), sent_by = auth.uid()
   WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_weekly_missing_cost_list(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weekly_missing_cost_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_weekly_missing_cost_done(uuid, numeric) TO authenticated;
