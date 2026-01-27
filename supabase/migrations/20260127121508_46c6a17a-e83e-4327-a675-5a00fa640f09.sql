-- Update products_needs_enrichment view to include catalog imports
DROP VIEW IF EXISTS products_needs_enrichment;

CREATE VIEW products_needs_enrichment AS
SELECT * FROM products_cache
WHERE 
  -- Original: order-discovered products missing cost/stock
  (discovery_source = 'order' AND (cost_price IS NULL OR current_stock IS NULL))
  OR
  -- New: catalog imports that haven't been enriched yet
  (discovery_source = 'catalog_import' AND last_stock_sync IS NULL);