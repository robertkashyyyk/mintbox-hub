-- Merchant token (sellerId) for Listings Items API paths
-- (/listings/2021-08-01/items/{sellerId}/{sku}). Not secret — it appears in
-- public storefront URLs — but needed by any future listings write executor.
-- Verified live 2026-07-23 via amazon-listings-probe (GET item 200).
-- Applied to prod 2026-07-23 via MCP.
alter table amazon.connection add column if not exists seller_id text;
update amazon.connection set seller_id = 'A18KNZ0ID7MNQY' where seller_id is null;
