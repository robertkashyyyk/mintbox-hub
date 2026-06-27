-- Adding a brand never tagged its existing products with brand_id (it was only
-- ever set by one-off UPDATE migrations). So a new brand (e.g. KleberBond, KLE-)
-- has all-NULL brand_id, and anything that resolves brand via products_cache.brand_id
-- — the Liquidation brand dropdown (LEFT JOIN brands ON id = pc.brand_id), profit,
-- stock-health, etc. — can't see it. Fix: assign on brand add (trigger) + backfill.

-- Assign brand_id to a brand's currently-UNBRANDED matching products. Uses the
-- text_pattern_ops range (idx_products_cache_sku_pattern) so it's an index scan, and
-- only touches NULL rows so existing assignments / prefix-overlap calls are untouched.
CREATE OR REPLACE FUNCTION public.assign_brand_to_products(p_brand_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows integer; v_prefix text; v_style prefix_style;
BEGIN
  SELECT prefix, prefix_style INTO v_prefix, v_style FROM public.brands WHERE id = p_brand_id;
  IF v_prefix IS NULL OR v_prefix = '' THEN RETURN 0; END IF;
  UPDATE public.products_cache p
    SET brand_id = p_brand_id
  WHERE p.brand_id IS NULL
    AND ( (v_style = 'hyphen' AND p.sku ~>=~ (v_prefix || '-') AND p.sku ~<~ (v_prefix || '.'))
       OR (v_style = 'slash'  AND p.sku ~>=~ (v_prefix || '/') AND p.sku ~<~ (v_prefix || '0')) );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END
$function$;

-- Auto-tag a brand's products whenever a brand is added or its prefix changes.
CREATE OR REPLACE FUNCTION public.trg_assign_brand_products()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assign_brand_to_products(NEW.id);
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS brands_assign_products ON public.brands;
CREATE TRIGGER brands_assign_products
  AFTER INSERT OR UPDATE OF prefix, prefix_style ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.trg_assign_brand_products();

-- Backfill now. Longest prefix first so a more-specific brand (ASC-JPL-) claims its
-- products before a broader one (ASC-) would — for the currently-unbranded rows.
SELECT public.assign_brand_to_products(id)
FROM public.brands
ORDER BY length(prefix) DESC NULLS LAST;
