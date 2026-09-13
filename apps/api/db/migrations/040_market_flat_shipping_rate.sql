ALTER TABLE market_shipping_rates
  ADD COLUMN use_market_flat_rate BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN market_flat_rate NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (market_flat_rate >= 0);
