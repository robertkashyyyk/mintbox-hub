-- Add dispatched_status_ids column to mintsoft_settings
ALTER TABLE public.mintsoft_settings 
ADD COLUMN IF NOT EXISTS dispatched_status_ids integer[] NOT NULL DEFAULT '{40}';

-- Add comment for clarity
COMMENT ON COLUMN public.mintsoft_settings.dispatched_status_ids IS 'Array of Mintsoft Order Status IDs that count as fully dispatched/shipped orders for ingestion';