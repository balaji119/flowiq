-- Existing and legacy-created tenants remain Type A. Type cannot be changed in the UI.
ALTER TABLE tenants ADD COLUMN tenant_type TEXT NOT NULL DEFAULT 'A' CHECK (tenant_type IN ('A', 'B'));

CREATE TABLE order_products (
  id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, code TEXT NOT NULL, UNIQUE (tenant_id, name)
);
CREATE TABLE order_addresses (
  id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, address TEXT NOT NULL
);
CREATE TABLE order_artworks (
  stored_name TEXT PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL, created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE orders (
  id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', lines JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitting', 'submitted', 'attention')),
  quote_no TEXT NOT NULL DEFAULT '', job_nos JSONB NOT NULL DEFAULT '[]',
  error TEXT NOT NULL DEFAULT '', submission_log JSONB NOT NULL DEFAULT '[]',
  created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX orders_tenant_created ON orders(tenant_id, created_at DESC);
