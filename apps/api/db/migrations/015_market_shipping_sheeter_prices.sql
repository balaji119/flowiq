ALTER TABLE market_shipping_rates
  ADD COLUMN IF NOT EXISTS two_sheeter_price NUMERIC NOT NULL DEFAULT 0 CHECK (two_sheeter_price >= 0),
  ADD COLUMN IF NOT EXISTS four_sheeter_price NUMERIC NOT NULL DEFAULT 0 CHECK (four_sheeter_price >= 0),
  ADD COLUMN IF NOT EXISTS six_sheeter_price NUMERIC NOT NULL DEFAULT 0 CHECK (six_sheeter_price >= 0),
  ADD COLUMN IF NOT EXISTS eight_sheeter_price NUMERIC NOT NULL DEFAULT 0 CHECK (eight_sheeter_price >= 0);
