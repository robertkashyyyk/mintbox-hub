-- Drop the existing overly permissive policy on products_cache
DROP POLICY IF EXISTS "Anyone can view products cache" ON public.products_cache;

-- Create restrictive policies for products_cache
CREATE POLICY "Authenticated users can view products cache"
ON public.products_cache
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert products cache"
ON public.products_cache
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update products cache"
ON public.products_cache
FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete products cache"
ON public.products_cache
FOR DELETE
TO authenticated
USING (true);

-- Remove the api_key column from mintsoft_settings (we'll use the secret instead)
ALTER TABLE public.mintsoft_settings DROP COLUMN IF EXISTS api_key;