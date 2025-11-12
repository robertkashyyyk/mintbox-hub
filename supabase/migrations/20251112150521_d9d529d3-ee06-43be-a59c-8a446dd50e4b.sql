-- Drop the existing overly permissive policy
DROP POLICY IF EXISTS "Authenticated users can view emails" ON public.emails;

-- Create a new policy that only allows super users to view emails
CREATE POLICY "Only super users can view emails"
ON public.emails
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_user'::app_role));

-- Restrict other operations to super users as well
CREATE POLICY "Only super users can insert emails"
ON public.emails
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'super_user'::app_role));

CREATE POLICY "Only super users can update emails"
ON public.emails
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'super_user'::app_role));

CREATE POLICY "Only super users can delete emails"
ON public.emails
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'super_user'::app_role));