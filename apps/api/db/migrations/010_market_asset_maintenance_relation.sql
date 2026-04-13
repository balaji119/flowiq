ALTER TABLE market_assets
  ADD COLUMN IF NOT EXISTS maintenance_asset_id UUID REFERENCES market_assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_market_assets_maintenance_asset_id
  ON market_assets (maintenance_asset_id);
