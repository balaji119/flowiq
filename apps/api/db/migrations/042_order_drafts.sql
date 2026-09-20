-- Type B only: drafts can be edited until atomically claimed for submission.
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('draft', 'submitting', 'submitted', 'attention'));
ALTER TABLE orders ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
