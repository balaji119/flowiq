ALTER TABLE market_shipping_rates
  ADD COLUMN IF NOT EXISTS use_flat_rate_sheeters BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS use_flat_rate_megas BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE market_shipping_rates
SET
  use_flat_rate_sheeters = use_flat_rate,
  use_flat_rate_megas = use_flat_rate
WHERE use_flat_rate = TRUE
  AND use_flat_rate_sheeters = FALSE
  AND use_flat_rate_megas = FALSE;
