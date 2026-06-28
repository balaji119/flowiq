CREATE TABLE IF NOT EXISTS onedrive_artwork_imports (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  drive_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_etag TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'downloading', 'processing', 'saving', 'completed', 'error')),
  downloaded_bytes BIGINT NOT NULL DEFAULT 0,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  processed_pages INTEGER NOT NULL DEFAULT 0,
  total_pages INTEGER NOT NULL DEFAULT 0,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS onedrive_artwork_imports_user_campaign_idx
  ON onedrive_artwork_imports(user_id, campaign_id, created_at DESC);
