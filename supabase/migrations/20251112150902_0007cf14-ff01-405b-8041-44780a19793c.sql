-- Drop ALL existing policies on products_cache
DROP POLICY IF EXISTS "Anyone can view products cache" ON public.products_cache;
DROP POLICY IF EXISTS "Authenticated users can view products cache" ON public.products_cache;
DROP POLICY IF EXISTS "Authenticated users can insert products cache" ON public.products_cache;
DROP POLICY IF EXISTS "Authenticated users can update products cache" ON public.products_cache;
DROP POLICY IF EXISTS "Authenticated users can delete products cache" ON public.products_cache;
DROP POLICY IF EXISTS "Authenticated users can manage products cache" ON public.products_cache;

-- Create new restrictive policies for products_cache (authenticated users only)
CREATE POLICY "Auth users can view products"
ON public.products_cache
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Auth users can insert products"
ON public.products_cache
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Auth users can update products"
ON public.products_cache
FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Auth users can delete products"
ON public.products_cache
FOR DELETE
TO authenticated
USING (true);

-- Remove the api_key column from mintsoft_settings (we'll use the MINTSOFT_API_KEY secret instead)
ALTER TABLE public.mintsoft_settings DROP COLUMN IF EXISTS api_key;