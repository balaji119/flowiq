CREATE TABLE IF NOT EXISTS market_sheet_sizes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES market_assets(id) ON DELETE CASCADE,
  preset_key TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  width_mm NUMERIC NOT NULL DEFAULT 0 CHECK (width_mm >= 0),
  height_mm NUMERIC NOT NULL DEFAULT 0 CHECK (height_mm >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (asset_id IS NOT NULL AND preset_key = '')
    OR (asset_id IS NULL AND preset_key <> '')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_sheet_sizes_asset
  ON market_sheet_sizes (tenant_id, asset_id)
  WHERE asset_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_sheet_sizes_preset
  ON market_sheet_sizes (tenant_id, market_id, preset_key)
  WHERE asset_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_market_sheet_sizes_tenant_market
  ON market_sheet_sizes (tenant_id, market_id);
