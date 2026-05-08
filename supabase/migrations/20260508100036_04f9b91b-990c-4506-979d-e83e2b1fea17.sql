
-- 1) Brand columns for Auto LSA
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS auto_update_lsa boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_lsa_auto_update_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_lsa_auto_update_summary jsonb;

-- 2) Fast brands + counts RPC (single round-trip)
CREATE OR REPLACE FUNCTION public.get_brands_with_product_counts()
RETURNS TABLE(
  id uuid, name text, prefix text, prefix_style prefix_style, family text,
  remote_stock_feed_type remote_stock_feed_type, base_multiplier numeric,
  image_url_pattern text, image_search_domain text, created_at timestamptz,
  auto_update_lsa boolean, last_lsa_auto_update_at timestamptz,
  last_lsa_auto_update_summary jsonb,
  product_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    b.id, b.name, b.prefix, b.prefix_style, b.family,
    b.remote_stock_feed_type, b.base_multiplier,
    b.image_url_pattern, b.image_search_domain, b.created_at,
    b.auto_update_lsa, b.last_lsa_auto_update_at, b.last_lsa_auto_update_summary,
    COALESCE(c.cnt, 0)::bigint AS product_count
  FROM public.brands b
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt
    FROM public.products_cache p
    WHERE p.sku LIKE b.prefix ||
      CASE WHEN b.prefix_style = 'slash' THEN '/%' ELSE '-%' END
  ) c ON true
  ORDER BY b.name;
$$;

-- 3) Seed default schedule (disabled by default)
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'lsa.auto_update_schedule',
  '{"enabled": false, "frequency": "weekly", "day_of_week": 1, "day_of_month": 1, "time_uk": "06:00", "dry_run": true}'::jsonb,
  'Schedule for the Auto Update LSA cron. frequency: daily | weekly | monthly. day_of_week: 0=Sun..6=Sat. time_uk: HH:MM Europe/London.'
)
ON CONFLICT (key) DO NOTHING;
