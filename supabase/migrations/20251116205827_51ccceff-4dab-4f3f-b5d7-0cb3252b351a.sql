-- Create enum for remote stock feed types
CREATE TYPE public.remote_stock_feed_type AS ENUM ('email', 'google_sheet', 'direct_upload', 'ftp_push', 'ftp_pull');

-- Add remote_stock_feed_type column to brands table
ALTER TABLE public.brands 
ADD COLUMN remote_stock_feed_type public.remote_stock_feed_type;