CREATE TABLE IF NOT EXISTS calculator_mappings (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  asset TEXT NOT NULL,
  label TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '',
  quantities JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, market, asset)
);

CREATE INDEX IF NOT EXISTS idx_calculator_mappings_tenant_market
  ON calculator_mappings (tenant_id, market, asset);
