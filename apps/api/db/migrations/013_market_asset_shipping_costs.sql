CREATE TABLE IF NOT EXISTS market_asset_shipping_costs (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES market_assets(id) ON DELETE CASCADE,
  mega_shipping_rate NUMERIC NOT NULL DEFAULT 0 CHECK (mega_shipping_rate >= 0),
  dot_m_shipping_rate NUMERIC NOT NULL DEFAULT 0 CHECK (dot_m_shipping_rate >= 0),
  mp_shipping_rate NUMERIC NOT NULL DEFAULT 0 CHECK (mp_shipping_rate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_market_asset_shipping_costs_tenant_market
  ON market_asset_shipping_costs (tenant_id, market_id);
