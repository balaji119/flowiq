ALTER TABLE market_shipping_rates
  ADD COLUMN IF NOT EXISTS two_sheeter_sets_per_box INTEGER NOT NULL DEFAULT 15 CHECK (two_sheeter_sets_per_box > 0),
  ADD COLUMN IF NOT EXISTS four_sheeter_sets_per_box INTEGER NOT NULL DEFAULT 15 CHECK (four_sheeter_sets_per_box > 0),
  ADD COLUMN IF NOT EXISTS six_sheeter_sets_per_box INTEGER NOT NULL DEFAULT 15 CHECK (six_sheeter_sets_per_box > 0),
  ADD COLUMN IF NOT EXISTS eight_sheeter_sets_per_box INTEGER NOT NULL DEFAULT 15 CHECK (eight_sheeter_sets_per_box > 0);

UPDATE market_shipping_rates
SET
  two_sheeter_sets_per_box = sheeter_sets_per_box,
  four_sheeter_sets_per_box = sheeter_sets_per_box,
  six_sheeter_sets_per_box = sheeter_sets_per_box,
  eight_sheeter_sets_per_box = sheeter_sets_per_box;
