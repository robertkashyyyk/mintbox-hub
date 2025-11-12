-- Drop the existing overly permissive policy
DROP POLICY IF EXISTS "Authenticated users can view mintsoft settings" ON public.mintsoft_settings;

-- Create a new policy that only allows super users to view mintsoft settings
CREATE POLICY "Only super users can view mintsoft settings"
ON public.mintsoft_settings
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_user'::app_role));

-- Also restrict updates to super users only
CREATE POLICY "Only super users can update mintsoft settings"
ON public.mintsoft_settings
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'super_user'::app_role));

-- Restrict inserts to super users only
CREATE POLICY "Only super users can insert mintsoft settings"
ON public.mintsoft_settings
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'super_user'::app_role));