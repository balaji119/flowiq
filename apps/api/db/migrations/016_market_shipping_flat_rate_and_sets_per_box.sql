ALTER TABLE market_shipping_rates
  ADD COLUMN IF NOT EXISTS use_flat_rate BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sheeter_sets_per_box INTEGER NOT NULL DEFAULT 15 CHECK (sheeter_sets_per_box > 0);
