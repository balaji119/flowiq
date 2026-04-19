ALTER TABLE market_shipping_rates
  ADD COLUMN IF NOT EXISTS megas_per_box INTEGER NOT NULL DEFAULT 1 CHECK (megas_per_box > 0);
