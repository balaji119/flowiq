CREATE TABLE IF NOT EXISTS market_shipping_rates (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  shipping_rate NUMERIC NOT NULL CHECK (shipping_rate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, market_id)
);

CREATE INDEX IF NOT EXISTS idx_market_shipping_rates_tenant_market
  ON market_shipping_rates (tenant_id, market_id);
