ALTER TABLE sheet_name_overrides
  ADD COLUMN IF NOT EXISTS custom_sheet_size_formats JSONB NOT NULL DEFAULT '{}'::jsonb;
