-- Add RLS policies for brands table to allow super and senior users to manage brands

-- Allow super and senior users to update brands
CREATE POLICY "Super and senior users can update brands"
ON public.brands
FOR UPDATE
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role])
);

-- Allow super and senior users to delete brands
CREATE POLICY "Super and senior users can delete brands"
ON public.brands
FOR DELETE
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role])
);

-- Allow super and senior users to insert brands
CREATE POLICY "Super and senior users can insert brands"
ON public.brands
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['super_user'::app_role, 'senior_user'::app_role])
);