ALTER TABLE public.order_lines ADD COLUMN was_backordered boolean NOT NULL DEFAULT false;
ALTER TABLE public.order_lines ADD COLUMN last_backordered_at timestamptz;