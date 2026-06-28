CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_tenant_name
  ON materials (tenant_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_materials_tenant
  ON materials (tenant_id);
