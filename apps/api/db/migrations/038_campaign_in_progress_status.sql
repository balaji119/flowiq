DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'campaigns'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE campaigns DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

UPDATE campaigns
SET status = 'in_progress'
WHERE status IN ('draft', 'calculated');

ALTER TABLE campaigns
ADD CONSTRAINT campaigns_status_check CHECK (status IN ('in_progress', 'submitted'));
