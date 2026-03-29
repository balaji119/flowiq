CREATE TABLE IF NOT EXISTS markets (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_markets_tenant_name
  ON markets (tenant_id, name);

CREATE TABLE IF NOT EXISTS market_assets (
  id UUID PRIMARY KEY,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  label TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '',
  quantities JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (market_id, asset)
);

CREATE INDEX IF NOT EXISTS idx_market_assets_market_asset
  ON market_assets (market_id, asset);

CREATE TABLE IF NOT EXISTS market_delivery_addresses (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  delivery_address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, market_id)
);

CREATE INDEX IF NOT EXISTS idx_market_delivery_addresses_tenant_market
  ON market_delivery_addresses (tenant_id, market_id);
