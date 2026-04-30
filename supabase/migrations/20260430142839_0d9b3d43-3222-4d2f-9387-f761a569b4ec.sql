
ALTER TABLE public.carrier_documents
  ADD COLUMN IF NOT EXISTS original_filename text,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS mime_type text;

CREATE INDEX IF NOT EXISTS idx_carrier_documents_carrier_filename
  ON public.carrier_documents (carrier_id, original_filename);
