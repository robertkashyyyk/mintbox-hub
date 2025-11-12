-- Drop ALL existing policies on mintsoft_settings
DROP POLICY IF EXISTS "Authenticated users can view mintsoft settings" ON public.mintsoft_settings;
DROP POLICY IF EXISTS "Only super users can view mintsoft settings" ON public.mintsoft_settings;
DROP POLICY IF EXISTS "Only super users can update mintsoft settings" ON public.mintsoft_settings;
DROP POLICY IF EXISTS "Only super users can insert mintsoft settings" ON public.mintsoft_settings;

-- Create new restrictive policies for super users only
CREATE POLICY "Super users can view mintsoft settings"
ON public.mintsoft_settings
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_user'::app_role));

CREATE POLICY "Super users can update mintsoft settings"
ON public.mintsoft_settings
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'super_user'::app_role));

CREATE POLICY "Super users can insert mintsoft settings"
ON public.mintsoft_settings
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'super_user'::app_role));