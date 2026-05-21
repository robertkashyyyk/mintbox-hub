-- Step 1: persist Mintsoft OrderNumber on order_lines + derive marketplace order id

ALTER TABLE public.order_lines
  ADD COLUMN IF NOT EXISTS order_number text;

CREATE INDEX IF NOT EXISTS idx_order_lines_order_number
  ON public.order_lines (order_number)
  WHERE order_number IS NOT NULL;

-- Channel-aware derivation of the marketplace order id from a Mintsoft OrderNumber.
-- eBay: strip the trailing "-NNNNNNN" Mintsoft line sequence (4-7 digits).
-- Amazon: 1:1 use as-is.
-- Other channels: return NULL until rules are added.
CREATE OR REPLACE FUNCTION public.derive_marketplace_order_id(
  _order_number text,
  _channel text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  ch text;
BEGIN
  IF _order_number IS NULL OR length(trim(_order_number)) = 0 THEN
    RETURN NULL;
  END IF;

  ch := lower(coalesce(_channel, ''));

  -- eBay channels (e.g. "eBay - CPI", "eBay - 123 Autocare", "Ebay")
  IF ch LIKE 'ebay%' THEN
    -- Pattern: {ebayOrderId}-{4-7 digit mintsoft seq}
    -- Strip last "-NNNN..NNNNNNN" segment if it matches.
    RETURN regexp_replace(_order_number, '-[0-9]{4,7}$', '');
  END IF;

  -- Amazon channels
  IF ch LIKE 'amazon%' THEN
    RETURN _order_number;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON COLUMN public.order_lines.order_number IS
  'Raw Mintsoft OrderNumber as supplied by the Mintsoft API. Use derive_marketplace_order_id() to extract the marketplace order id for join with 3D Sellers.';
COMMENT ON FUNCTION public.derive_marketplace_order_id(text, text) IS
  'Phase 4 join helper: strips Mintsoft line-sequence suffix from eBay OrderNumbers; passes Amazon through. Returns NULL for unsupported channels.';