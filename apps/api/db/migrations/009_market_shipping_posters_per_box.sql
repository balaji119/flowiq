ALTER TABLE market_shipping_rates
  ADD COLUMN IF NOT EXISTS posters_per_box INTEGER NOT NULL DEFAULT 60 CHECK (posters_per_box > 0);
