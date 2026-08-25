-- Per-brand reorder-cadence reminders. A daily dispatcher (edge fn
-- brand-order-due-email, cron jobid 119 @ 08:00 UTC) emails Steven & Clive
-- the brand's current buy list when its next_due_date arrives, then rolls the
-- date forward by the cadence. next_due_date is the single firing source of truth.

-- ---- Date helpers (pure, IMMUTABLE) --------------------------------------
-- Clamp a day-of-month to a valid date in the given year/month (e.g. 31 -> 28 in Feb).
CREATE OR REPLACE FUNCTION public._clamp_dom(p_year int, p_month int, p_dom int)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT make_date(p_year, p_month,
    LEAST(GREATEST(p_dom, 1),
          EXTRACT(day FROM (make_date(p_year, p_month, 1) + INTERVAL '1 month' - INTERVAL '1 day'))::int));
$$;

-- Next date strictly after p_from that lands on weekday p_dow (0=Sun .. 6=Sat, matching extract(dow)).
CREATE OR REPLACE FUNCTION public._next_dow(p_from date, p_dow int)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT p_from + (CASE
    WHEN ((p_dow - EXTRACT(dow FROM p_from)::int) % 7 + 7) % 7 = 0 THEN 7
    ELSE ((p_dow - EXTRACT(dow FROM p_from)::int) % 7 + 7) % 7 END);
$$;

-- Next occurrence of a day-of-month strictly after p_from (this month if still ahead, else next month).
CREATE OR REPLACE FUNCTION public._next_dom(p_from date, p_dom int)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN public._clamp_dom(EXTRACT(year FROM p_from)::int, EXTRACT(month FROM p_from)::int, p_dom) > p_from
      THEN public._clamp_dom(EXTRACT(year FROM p_from)::int, EXTRACT(month FROM p_from)::int, p_dom)
    ELSE public._clamp_dom(
           EXTRACT(year  FROM (p_from + INTERVAL '1 month'))::int,
           EXTRACT(month FROM (p_from + INTERVAL '1 month'))::int, p_dom)
  END;
$$;

-- Seed the FIRST due date for a freshly-set/edited schedule: the next matching day.
CREATE OR REPLACE FUNCTION public.seed_order_due(p_cadence text, p_dow int, p_dom int, p_from date DEFAULT current_date)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_cadence IN ('weekly','fortnightly') THEN public._next_dow(p_from, COALESCE(p_dow, 1))
    WHEN p_cadence IN ('monthly','quarterly')  THEN public._next_dom(p_from, COALESCE(p_dom, 1))
    ELSE NULL::date END;
$$;

-- Advance a due date forward by one cadence step, skipping any fully-missed cycles
-- so a lapsed schedule resumes on its next FUTURE slot (no retroactive backlog).
CREATE OR REPLACE FUNCTION public.advance_order_due(p_cadence text, p_dom int, p_from date, p_today date DEFAULT current_date)
RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE nd date := p_from;
BEGIN
  LOOP
    nd := CASE p_cadence
      WHEN 'weekly'      THEN nd + 7
      WHEN 'fortnightly' THEN nd + 14
      WHEN 'monthly'     THEN public._clamp_dom(
                              EXTRACT(year  FROM (nd + INTERVAL '1 month'))::int,
                              EXTRACT(month FROM (nd + INTERVAL '1 month'))::int,
                              COALESCE(p_dom, EXTRACT(day FROM nd)::int))
      WHEN 'quarterly'   THEN public._clamp_dom(
                              EXTRACT(year  FROM (nd + INTERVAL '3 months'))::int,
                              EXTRACT(month FROM (nd + INTERVAL '3 months'))::int,
                              COALESCE(p_dom, EXTRACT(day FROM nd)::int))
      ELSE nd + 7 END;
    EXIT WHEN nd > p_today;
  END LOOP;
  RETURN nd;
END $$;

GRANT EXECUTE ON FUNCTION public._clamp_dom(int,int,int) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public._next_dow(date,int) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public._next_dom(date,int) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.seed_order_due(text,int,int,date) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.advance_order_due(text,int,date,date) TO authenticated, anon;

-- ---- Schedule table -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brand_order_schedule (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         uuid NOT NULL UNIQUE REFERENCES public.brands(id) ON DELETE CASCADE,
  cadence          text NOT NULL CHECK (cadence IN ('weekly','fortnightly','monthly','quarterly')),
  day_of_week      int  CHECK (day_of_week  BETWEEN 0 AND 6),
  day_of_month     int  CHECK (day_of_month BETWEEN 1 AND 31),
  next_due_date    date NOT NULL,
  enabled          boolean NOT NULL DEFAULT true,
  last_sent_at     timestamptz,
  last_send_result jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_order_schedule_due
  ON public.brand_order_schedule (next_due_date) WHERE enabled;

ALTER TABLE public.brand_order_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view order schedules"
  ON public.brand_order_schedule FOR SELECT USING (true);
CREATE POLICY "Super and senior manage order schedules"
  ON public.brand_order_schedule FOR ALL TO authenticated
  USING      (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_order_schedule TO authenticated;
GRANT SELECT ON public.brand_order_schedule TO anon;
