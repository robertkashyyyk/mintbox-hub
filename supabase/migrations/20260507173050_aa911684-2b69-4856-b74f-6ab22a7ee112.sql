CREATE TABLE IF NOT EXISTS public.threeds_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name text NOT NULL,
  mintsoft_channel text NOT NULL UNIQUE,
  sftp_filename text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.threeds_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read threeds_stores" ON public.threeds_stores;
CREATE POLICY "auth read threeds_stores" ON public.threeds_stores
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "super manage threeds_stores" ON public.threeds_stores;
CREATE POLICY "super manage threeds_stores" ON public.threeds_stores
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'super_user'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_user'::app_role));

CREATE TABLE IF NOT EXISTS public.threeds_reprice_pushes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.threeds_stores(id) ON DELETE CASCADE,
  pushed_at timestamptz NOT NULL DEFAULT now(),
  pushed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  row_count integer NOT NULL DEFAULT 0,
  csv_preview text,
  sftp_path text,
  status text NOT NULL DEFAULT 'pending',
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_threeds_reprice_pushes_store_id_pushed_at
  ON public.threeds_reprice_pushes (store_id, pushed_at DESC);

ALTER TABLE public.threeds_reprice_pushes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read threeds_reprice_pushes" ON public.threeds_reprice_pushes;
CREATE POLICY "auth read threeds_reprice_pushes" ON public.threeds_reprice_pushes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service write threeds_reprice_pushes" ON public.threeds_reprice_pushes;
CREATE POLICY "service write threeds_reprice_pushes" ON public.threeds_reprice_pushes
  FOR ALL TO service_role USING (true) WITH CHECK (true);