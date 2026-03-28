CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'user')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL DEFAULT '',
  start_date DATE,
  due_date DATE,
  weeks INTEGER NOT NULL DEFAULT 1 CHECK (weeks > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'calculated', 'submitted')),
  form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculation_summary JSONB,
  purchase_order JSONB,
  latest_quote_amount NUMERIC,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  updated_by_user_id UUID NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_lines (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  asset_label TEXT NOT NULL DEFAULT '',
  selected_weeks JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  amount NUMERIC,
  status TEXT NOT NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  external_job_id TEXT,
  status TEXT NOT NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_id ON campaigns (tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_lines_campaign_id ON campaign_lines (campaign_id);
CREATE INDEX IF NOT EXISTS idx_quotes_campaign_id ON quotes (campaign_id);
CREATE INDEX IF NOT EXISTS idx_jobs_campaign_id ON jobs (campaign_id);
