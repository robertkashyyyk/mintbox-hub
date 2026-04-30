
CREATE TABLE IF NOT EXISTS public.carrier_reason_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid REFERENCES public.carriers(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, code)
);

ALTER TABLE public.carrier_reason_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read carrier_reason_codes" ON public.carrier_reason_codes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all carrier_reason_codes" ON public.carrier_reason_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "staff write carrier_reason_codes" ON public.carrier_reason_codes
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));

CREATE TRIGGER set_updated_at_carrier_reason_codes
  BEFORE UPDATE ON public.carrier_reason_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.carrier_packers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.carrier_packers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read carrier_packers" ON public.carrier_packers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service all carrier_packers" ON public.carrier_packers
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "staff write carrier_packers" ON public.carrier_packers
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));

CREATE TRIGGER set_updated_at_carrier_packers
  BEFORE UPDATE ON public.carrier_packers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
