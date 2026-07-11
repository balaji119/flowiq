CREATE TABLE market_material_mappings (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  sheet_key TEXT NOT NULL,
  product_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, market_id, sheet_key)
);

CREATE INDEX idx_market_material_mappings_market_id ON market_material_mappings(market_id);
