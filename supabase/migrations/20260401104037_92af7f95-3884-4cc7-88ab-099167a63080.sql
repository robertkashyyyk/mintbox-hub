
-- Extend order_lines with monitoring fields
ALTER TABLE public.order_lines
  ADD COLUMN IF NOT EXISTS order_status text,
  ADD COLUMN IF NOT EXISTS order_status_id integer,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS times_seen integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_status_change_at timestamptz DEFAULT now();

-- Create order_issues table for operational tracking
CREATE TABLE public.order_issues (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mintsoft_order_id integer NOT NULL,
  line_index integer NOT NULL,
  sku text NOT NULL,
  brand_id uuid REFERENCES public.brands(id),
  problem_type text NOT NULL,
  severity text NOT NULL DEFAULT 'watch',
  reason text,
  issue_status text NOT NULL DEFAULT 'open',
  assigned_to text,
  internal_notes text,
  resolved_at timestamptz,
  resolution_type text,
  first_problem_seen_at timestamptz NOT NULL DEFAULT now(),
  last_problem_seen_at timestamptz NOT NULL DEFAULT now(),
  is_suppressed boolean NOT NULL DEFAULT false,
  suppressed_until timestamptz,
  suppression_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mintsoft_order_id, line_index, problem_type)
);

-- Enable RLS
ALTER TABLE public.order_issues ENABLE ROW LEVEL SECURITY;

-- RLS policies for order_issues
CREATE POLICY "Authenticated users can view order issues"
  ON public.order_issues FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert order issues"
  ON public.order_issues FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update order issues"
  ON public.order_issues FOR UPDATE TO authenticated
  USING (true);

-- Service role needs full access for edge functions
CREATE POLICY "Service role full access on order issues"
  ON public.order_issues FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Updated_at trigger for order_issues
CREATE TRIGGER set_order_issues_updated_at
  BEFORE UPDATE ON public.order_issues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
