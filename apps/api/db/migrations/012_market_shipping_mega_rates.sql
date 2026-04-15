ALTER TABLE market_shipping_rates
  ADD COLUMN IF NOT EXISTS mega_shipping_rate NUMERIC NOT NULL DEFAULT 0 CHECK (mega_shipping_rate >= 0),
  ADD COLUMN IF NOT EXISTS dot_m_shipping_rate NUMERIC NOT NULL DEFAULT 0 CHECK (dot_m_shipping_rate >= 0),
  ADD COLUMN IF NOT EXISTS mp_shipping_rate NUMERIC NOT NULL DEFAULT 0 CHECK (mp_shipping_rate >= 0);
