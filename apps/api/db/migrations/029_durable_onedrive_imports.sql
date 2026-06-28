ALTER TABLE onedrive_artwork_imports
  ADD COLUMN IF NOT EXISTS access_token_ciphertext TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS download_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS onedrive_artwork_imports_worker_idx
  ON onedrive_artwork_imports(status, locked_until, created_at)
  WHERE status IN ('queued', 'downloading', 'processing', 'saving');
