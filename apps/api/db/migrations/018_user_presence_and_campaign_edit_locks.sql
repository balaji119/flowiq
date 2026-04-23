CREATE TABLE IF NOT EXISTS user_presence (
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_presence_tenant_last_seen
  ON user_presence (tenant_id, last_seen DESC);

CREATE TABLE IF NOT EXISTS campaign_edit_locks (
  campaign_id UUID PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaign_edit_locks_tenant_expires
  ON campaign_edit_locks (tenant_id, expires_at DESC);
