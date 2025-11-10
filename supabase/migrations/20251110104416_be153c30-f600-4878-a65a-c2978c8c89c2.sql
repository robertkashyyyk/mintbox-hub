-- Create emails table
CREATE TABLE public.emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL,
  labels TEXT[] DEFAULT '{}',
  body TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create alerts table with enum
CREATE TYPE public.alert_type AS ENUM ('LowStock', 'RemoteStock', 'BackOrders');
CREATE TYPE public.severity_type AS ENUM ('info', 'warning', 'critical');

CREATE TABLE public.alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email_id UUID NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  alert_type alert_type NOT NULL,
  severity severity_type NOT NULL DEFAULT 'info',
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ingest_logs table
CREATE TABLE public.ingest_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingest_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for emails (admins only)
CREATE POLICY "Authenticated users can view emails"
ON public.emails FOR SELECT
TO authenticated
USING (true);

-- RLS policies for alerts (admins only)
CREATE POLICY "Authenticated users can view alerts"
ON public.alerts FOR SELECT
TO authenticated
USING (true);

-- RLS policies for ingest_logs (admins only)
CREATE POLICY "Authenticated users can view ingest logs"
ON public.ingest_logs FOR SELECT
TO authenticated
USING (true);

-- Add updated_at trigger for emails
CREATE TRIGGER update_emails_updated_at
BEFORE UPDATE ON public.emails
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();