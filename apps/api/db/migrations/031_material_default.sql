ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS position
  FROM materials
)
UPDATE materials
SET is_default = TRUE
FROM ranked
WHERE materials.id = ranked.id
  AND ranked.position = 1
  AND NOT EXISTS (
    SELECT 1
    FROM materials existing_default
    WHERE existing_default.tenant_id = materials.tenant_id
      AND existing_default.is_default = TRUE
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_one_default_per_tenant
  ON materials (tenant_id)
  WHERE is_default = TRUE;
