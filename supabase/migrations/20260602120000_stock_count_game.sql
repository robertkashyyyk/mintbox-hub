-- Stock Count Game
-- Lets staff capture first-ever stock counts for "never counted" SKUs and push
-- them to Mintsoft. Mirrors the Missing Costs Game's data-access patterns.

-- 1) Per-SKU "last counted by this game" flag. Set the moment a count is captured
--    (any quantity, including 0) so a SKU drops out of the never-counted pool even
--    when a 0 produces no Mintsoft movement.
ALTER TABLE public.products_cache
  ADD COLUMN IF NOT EXISTS counted_at timestamptz;

COMMENT ON COLUMN public.products_cache.counted_at IS
  'Set by the Stock Count Game when a count is captured (any qty incl 0). NULL = never counted by the game.';

-- 2) Config: warehouse IDs and the strict-movement-check flag (not hardcoded).
INSERT INTO public.app_settings (key, value, description) VALUES
  ('warehouse.coleraine_id', '5'::jsonb,
   'Mintsoft WarehouseId for Coleraine Live (authoritative stock).'),
  ('warehouse.main_id', '3'::jsonb,
   'Mintsoft WarehouseId for Main Warehouse (dummy/placeholder stock; wiped to 0 on count).'),
  ('scg.strict_movement_check', 'false'::jsonb,
   'When true, the Stock Count Game verifies no Coleraine stock-movement history via live Mintsoft before offering a SKU. Requires the movements read endpoint to be confirmed/enabled.')
ON CONFLICT (key) DO NOTHING;

-- 3) Durable capture / sync queue / leaderboard source. Capture writes here
--    synchronously the instant the player hits Next, decoupled from Mintsoft sync.
CREATE TABLE IF NOT EXISTS public.stock_count_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  sku text NOT NULL,
  mintsoft_product_id integer,
  brand_id uuid,
  counted_qty integer NOT NULL CHECK (counted_qty >= 0),
  counted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  counted_by_email text,
  -- pending | synced | failed | flagged (flagged = real Coleraine stock appeared since we offered it)
  sync_status text NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'synced', 'failed', 'flagged')),
  sync_error text,
  synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS stock_count_events_created_at_idx ON public.stock_count_events (created_at DESC);
CREATE INDEX IF NOT EXISTS stock_count_events_sync_status_idx ON public.stock_count_events (sync_status);
CREATE INDEX IF NOT EXISTS stock_count_events_counted_by_idx ON public.stock_count_events (counted_by);

ALTER TABLE public.stock_count_events ENABLE ROW LEVEL SECURITY;

-- Reads: any authenticated staff (supports the optional leaderboard). Writes happen
-- through SECURITY DEFINER routines (capture RPC + service-role sync), so no direct
-- INSERT/UPDATE policy is granted to clients.
CREATE POLICY "Authenticated can view stock count events"
  ON public.stock_count_events
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE public.stock_count_events IS
  'One row per captured stock count from the Stock Count Game. Durable capture, Mintsoft sync queue, and leaderboard source.';

-- 4) Capture RPC: insert the event and stamp counted_at atomically. Runs as the
--    caller via auth.uid(); SECURITY DEFINER so it can write past products_cache RLS.
CREATE OR REPLACE FUNCTION public.capture_stock_count(p_sku text, p_qty integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _email text;
  _pc record;
  _event_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_qty IS NULL OR p_qty < 0 OR p_qty <> floor(p_qty) THEN
    RAISE EXCEPTION 'Quantity must be a non-negative integer';
  END IF;

  SELECT id, sku, mintsoft_product_id, brand_id
  INTO _pc
  FROM public.products_cache
  WHERE sku = p_sku
  LIMIT 1;

  IF _pc.id IS NULL THEN
    RAISE EXCEPTION 'Unknown SKU: %', p_sku;
  END IF;

  SELECT email INTO _email FROM auth.users WHERE id = _uid;

  INSERT INTO public.stock_count_events
    (sku, mintsoft_product_id, brand_id, counted_qty, counted_by, counted_by_email)
  VALUES
    (_pc.sku, _pc.mintsoft_product_id, _pc.brand_id, p_qty, _uid, _email)
  RETURNING id INTO _event_id;

  -- Drop the SKU out of the never-counted pool. We deliberately do NOT touch
  -- current_stock here: the next Mintsoft stock sync pulls the authoritative
  -- Coleraine figure back, so we avoid mirror divergence on a failed sync.
  UPDATE public.products_cache
  SET counted_at = now()
  WHERE id = _pc.id;

  RETURN _event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.capture_stock_count(text, integer) TO authenticated;

-- 5) Brand picker: qualifying ("never counted") SKU count per brand.
--    Coleraine on-hand 0 + not yet counted by the game. The strict Coleraine
--    movement-history test is applied later (live Mintsoft, behind a flag).
CREATE OR REPLACE FUNCTION public.get_never_counted_brand_counts()
RETURNS TABLE(brand_id uuid, brand_name text, qualifying_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pc.brand_id, b.name AS brand_name, count(*)::bigint AS qualifying_count
  FROM public.products_cache pc
  JOIN public.brands b ON b.id = pc.brand_id
  WHERE COALESCE(pc.current_stock, 0) = 0
    AND pc.counted_at IS NULL
    AND COALESCE(pc.discontinued, false) = false
    AND COALESCE(pc.quarantined, false) = false
    AND pc.brand_id IS NOT NULL
    AND pc.mintsoft_product_id IS NOT NULL
  GROUP BY pc.brand_id, b.name
  HAVING count(*) > 0
  ORDER BY count(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_never_counted_brand_counts() TO authenticated;

-- 6) Count-list builder: qualifying SKUs for one brand. Client shuffles/slices
--    (random Number mode) or shows all (Full / Selected). Capped for safety.
CREATE OR REPLACE FUNCTION public.get_never_counted_skus(p_brand_id uuid, p_limit integer DEFAULT 1000)
RETURNS TABLE(
  id uuid,
  sku text,
  name text,
  brand_id uuid,
  brand_name text,
  mintsoft_product_id integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pc.id, pc.sku, pc.name, pc.brand_id, b.name AS brand_name, pc.mintsoft_product_id
  FROM public.products_cache pc
  JOIN public.brands b ON b.id = pc.brand_id
  WHERE pc.brand_id = p_brand_id
    AND COALESCE(pc.current_stock, 0) = 0
    AND pc.counted_at IS NULL
    AND COALESCE(pc.discontinued, false) = false
    AND COALESCE(pc.quarantined, false) = false
    AND pc.mintsoft_product_id IS NOT NULL
  ORDER BY pc.sku
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_never_counted_skus(uuid, integer) TO authenticated;
