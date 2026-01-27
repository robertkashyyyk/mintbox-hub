-- Create integrations table for external service management
CREATE TABLE public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  base_url text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_connected_at timestamptz,
  connection_status text NOT NULL DEFAULT 'not_configured',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add check constraint for connection_status
ALTER TABLE public.integrations 
ADD CONSTRAINT integrations_connection_status_check 
CHECK (connection_status IN ('connected', 'error', 'not_configured', 'testing'));

-- Enable RLS
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- RLS policies - super_users only
CREATE POLICY "Super users can view integrations"
ON public.integrations FOR SELECT
USING (has_role(auth.uid(), 'super_user'::app_role));

CREATE POLICY "Super users can insert integrations"
ON public.integrations FOR INSERT
WITH CHECK (has_role(auth.uid(), 'super_user'::app_role));

CREATE POLICY "Super users can update integrations"
ON public.integrations FOR UPDATE
USING (has_role(auth.uid(), 'super_user'::app_role));

CREATE POLICY "Super users can delete integrations"
ON public.integrations FOR DELETE
USING (has_role(auth.uid(), 'super_user'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_integrations_updated_at
BEFORE UPDATE ON public.integrations
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Seed initial integrations
INSERT INTO public.integrations (name, display_name, enabled, base_url, config, connection_status)
SELECT 
  'mintsoft',
  'Mintsoft',
  true,
  ms.base_url,
  jsonb_build_object('dispatched_status_ids', ms.dispatched_status_ids),
  'not_configured'
FROM public.mintsoft_settings ms
WHERE ms.id = true
ON CONFLICT (name) DO NOTHING;

-- Add 3D Sellers placeholder
INSERT INTO public.integrations (name, display_name, enabled, base_url, config, connection_status)
VALUES ('3dsellers', '3D Sellers', false, null, '{}'::jsonb, 'not_configured')
ON CONFLICT (name) DO NOTHING;