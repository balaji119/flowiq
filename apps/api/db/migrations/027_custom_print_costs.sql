ALTER TABLE sheet_name_overrides
  ADD COLUMN IF NOT EXISTS custom_print_cost_formats JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS custom_print_costs (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sheet_key TEXT NOT NULL,
  one_page_cost NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (one_page_cost >= 0),
  two_page_cost NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (two_page_cost >= 0),
  five_page_cost NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (five_page_cost >= 0),
  ten_plus_page_cost NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (ten_plus_page_cost >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, sheet_key)
);

CREATE INDEX IF NOT EXISTS idx_custom_print_costs_tenant
  ON custom_print_costs (tenant_id);
