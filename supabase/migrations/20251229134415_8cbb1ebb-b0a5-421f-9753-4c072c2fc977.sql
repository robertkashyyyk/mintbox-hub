-- Add unique constraint on status_id for mintsoft_status_cache upserts
ALTER TABLE public.mintsoft_status_cache 
ADD CONSTRAINT mintsoft_status_cache_status_id_key UNIQUE (status_id);