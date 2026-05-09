ALTER TABLE sheet_name_overrides
  ADD COLUMN IF NOT EXISTS multiple_artwork_formats JSONB NOT NULL DEFAULT '{}'::jsonb;

