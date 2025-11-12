-- Create upload history table
CREATE TABLE public.upload_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  upload_name TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  items_imported INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;

-- Users can view their own upload history
CREATE POLICY "Users can view their own upload history"
ON public.upload_history
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own upload history
CREATE POLICY "Users can insert their own upload history"
ON public.upload_history
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX idx_upload_history_user_id ON public.upload_history(user_id);
CREATE INDEX idx_upload_history_uploaded_at ON public.upload_history(uploaded_at DESC);