UPDATE products_cache
SET mintsoft_resolve_attempts = 0,
    last_mintsoft_resolve_attempt_at = NULL
WHERE mintsoft_product_id IS NULL
  AND last_mintsoft_resolve_attempt_at > '2026-05-19 09:20:00+00';