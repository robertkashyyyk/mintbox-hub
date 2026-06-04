-- Configurable carrier format/service categories
-- Used to: (1) classify measured items into correct postal format,
--           (2) know which Mintsoft category IDs to swap when remeasuring,
--           (3) store pricing per format for cost calculations.

CREATE TABLE IF NOT EXISTS carrier_format_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid REFERENCES carriers(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  mintsoft_category_id integer,
  max_length_mm numeric,
  max_width_mm numeric,
  max_height_mm numeric,
  max_weight_g numeric,
  price_pence integer,
  is_format_category boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(carrier_id, slug)
);

INSERT INTO carrier_format_services (name, slug, mintsoft_category_id, max_length_mm, max_width_mm, max_height_mm, max_weight_g, sort_order, notes)
VALUES
  ('Large Letter', 'large-letter', 122, 353, 250, 25, 750, 1, 'Royal Mail Large Letter'),
  ('Parcel', 'parcel', NULL, 610, 460, 460, 5000, 2, 'Royal Mail / standard parcel up to 5kg'),
  ('DHL', 'dhl', NULL, NULL, NULL, NULL, NULL, 3, 'DHL — over standard parcel dims'),
  ('Oversized', 'oversized', NULL, NULL, NULL, NULL, NULL, 4, 'Rarely used placeholder for very large items')
ON CONFLICT (carrier_id, slug) DO NOTHING;

-- RPC: brand-level summary of open remeasure tasks (for the game setup screen)
CREATE OR REPLACE FUNCTION get_remeasure_brand_counts()
RETURNS TABLE(brand_id uuid, brand_name text, open_count bigint, total_cost numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT 
    b.id, b.name,
    COUNT(*) FILTER (WHERE t.status NOT IN ('completed')) as open_count,
    COALESCE(SUM(cp.penalty_amount) FILTER (WHERE t.status NOT IN ('completed')), 0) as total_cost
  FROM carrier_remeasure_tasks t
  JOIN products_cache pc ON pc.sku = t.sku
  JOIN brands b ON b.id = pc.brand_id
  LEFT JOIN carrier_penalties cp ON cp.id = t.penalty_id
  WHERE t.status NOT IN ('completed')
  GROUP BY b.id, b.name
  HAVING COUNT(*) FILTER (WHERE t.status NOT IN ('completed')) > 0
  ORDER BY open_count DESC;
$$;
