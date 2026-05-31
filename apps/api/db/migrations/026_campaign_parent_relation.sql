ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS parent_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_parent_campaign_id ON campaigns (tenant_id, parent_campaign_id);
