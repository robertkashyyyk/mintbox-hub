-- Price Campaigns — Phase 1: one concept for liquidation/sale (now) and
-- elasticity tests (later). Records the deliberate price strategy on a SKU so
-- the repricer can ring-fence it, we can measure vs a baseline, and revert to
-- the original price.

CREATE TABLE IF NOT EXISTS public.price_campaigns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku               text NOT NULL,
  type              text NOT NULL DEFAULT 'liquidation'
                      CHECK (type IN ('liquidation','elasticity','promo')),
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','ended','reverted')),
  -- pricing
  original_price    numeric,          -- snapshot at launch (for revert)
  campaign_price    numeric,          -- the sale/test price
  -- baseline captured at launch (to judge "is it working")
  baseline_velocity numeric,
  baseline_stock    numeric,
  baseline_cost     numeric,
  -- lifecycle
  start_date        date NOT NULL DEFAULT current_date,
  end_date          date,
  outcome           text CHECK (outcome IN ('worked','no_effect','reverted','too_early')),
  notes             text,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- At most one ACTIVE campaign per SKU (the ring-fence)
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_campaign_active
  ON public.price_campaigns(sku) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_price_campaigns_sku ON public.price_campaigns(sku);
CREATE INDEX IF NOT EXISTS idx_price_campaigns_status ON public.price_campaigns(status);

ALTER TABLE public.price_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read price_campaigns"  ON public.price_campaigns FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write price_campaigns" ON public.price_campaigns FOR ALL    TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_price_campaigns_updated_at ON public.price_campaigns;
CREATE TRIGGER trg_price_campaigns_updated_at
  BEFORE UPDATE ON public.price_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Liquidation candidate scoring: slow/dead velocity + capital tied up,
-- excluding SKUs already under an active campaign.
CREATE OR REPLACE FUNCTION public.get_liquidation_candidates(
  max_velocity   numeric DEFAULT 0.5,   -- units/week at or below = slow
  min_capital    numeric DEFAULT 25,    -- min stock value (stock × cost) to bother
  limit_n        integer DEFAULT 100
)
RETURNS TABLE(
  sku text,
  product_name text,
  brand_name text,
  current_stock numeric,
  cost_price numeric,
  velocity_per_week numeric,
  units_sold_90d integer,
  weeks_of_cover numeric,
  capital_tied numeric,
  in_campaign boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    pc.sku,
    pc.name,
    b.name AS brand_name,
    pc.current_stock,
    pc.cost_price,
    COALESCE(pc.velocity_per_week, 0) AS velocity_per_week,
    pc.units_sold_90d,
    CASE WHEN COALESCE(pc.velocity_per_week,0) > 0
         THEN round(pc.current_stock / pc.velocity_per_week, 1)
         ELSE NULL END AS weeks_of_cover,
    round(pc.current_stock * pc.cost_price, 2) AS capital_tied,
    EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku = pc.sku AND c.status = 'active') AS in_campaign
  FROM products_cache pc
  LEFT JOIN brands b ON b.id = pc.brand_id
  WHERE COALESCE(pc.discontinued, false) = false
    AND COALESCE(pc.quarantined, false) = false
    AND pc.current_stock > 0
    AND pc.cost_price > 0
    AND COALESCE(pc.velocity_per_week, 0) <= max_velocity
    AND (pc.current_stock * pc.cost_price) >= min_capital
    AND NOT EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku = pc.sku AND c.status = 'active')
  ORDER BY capital_tied DESC
  LIMIT GREATEST(limit_n, 1);
$$;
