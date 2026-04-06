ALTER TABLE market_delivery_addresses
ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

WITH ranked AS (
  SELECT
    tenant_id,
    market_id,
    delivery_address,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, market_id
      ORDER BY created_at ASC, delivery_address ASC
    ) AS row_num
  FROM market_delivery_addresses
)
UPDATE market_delivery_addresses mda
SET is_default = (ranked.row_num = 1)
FROM ranked
WHERE mda.tenant_id = ranked.tenant_id
  AND mda.market_id = ranked.market_id
  AND mda.delivery_address = ranked.delivery_address;

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_delivery_addresses_one_default_per_market
ON market_delivery_addresses (tenant_id, market_id)
WHERE is_default = TRUE;
