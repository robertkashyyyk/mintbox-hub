
CREATE TABLE IF NOT EXISTS public.lsa_unmatched_skus (
  sku text PRIMARY KEY,
  lsa numeric NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  seen_count integer NOT NULL DEFAULT 1,
  source_file text
);

ALTER TABLE public.lsa_unmatched_skus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read lsa_unmatched_skus"
  ON public.lsa_unmatched_skus FOR SELECT TO authenticated USING (true);

CREATE POLICY "service all lsa_unmatched_skus"
  ON public.lsa_unmatched_skus FOR ALL TO service_role USING (true) WITH CHECK (true);
