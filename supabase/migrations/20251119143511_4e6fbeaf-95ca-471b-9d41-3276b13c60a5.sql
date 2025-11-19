-- Create API keys table
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES public.profiles(id),
  active BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Super users can view all API keys
CREATE POLICY "Super users can view API keys"
  ON public.api_keys
  FOR SELECT
  USING (has_role(auth.uid(), 'super_user'::app_role));

-- Super users can create API keys
CREATE POLICY "Super users can create API keys"
  ON public.api_keys
  FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'super_user'::app_role));

-- Super users can update API keys
CREATE POLICY "Super users can update API keys"
  ON public.api_keys
  FOR UPDATE
  USING (has_role(auth.uid(), 'super_user'::app_role));

-- Super users can delete API keys
CREATE POLICY "Super users can delete API keys"
  ON public.api_keys
  FOR DELETE
  USING (has_role(auth.uid(), 'super_user'::app_role));

-- Create index for faster key lookups
CREATE INDEX idx_api_keys_key ON public.api_keys(key) WHERE active = true;