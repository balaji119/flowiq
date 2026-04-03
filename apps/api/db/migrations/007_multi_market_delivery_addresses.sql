ALTER TABLE market_delivery_addresses
  DROP CONSTRAINT IF EXISTS market_delivery_addresses_pkey;

ALTER TABLE market_delivery_addresses
  ADD CONSTRAINT market_delivery_addresses_unique UNIQUE (tenant_id, market_id, delivery_address);
