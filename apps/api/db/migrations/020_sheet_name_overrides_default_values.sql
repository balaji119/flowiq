ALTER TABLE sheet_name_overrides
  ALTER COLUMN overrides
  SET DEFAULT '{"8-sheet":"Quad","8-sheet-a0":"Quad A0","6-sheet":"Triple","4-sheet":"Double","2-sheet":"Single"}'::jsonb;

INSERT INTO sheet_name_overrides (tenant_id, overrides, created_at, updated_at)
SELECT
  t.id,
  '{"8-sheet":"Quad","8-sheet-a0":"Quad A0","6-sheet":"Triple","4-sheet":"Double","2-sheet":"Single"}'::jsonb,
  NOW(),
  NOW()
FROM tenants t
LEFT JOIN sheet_name_overrides s
  ON s.tenant_id = t.id
WHERE s.tenant_id IS NULL;
