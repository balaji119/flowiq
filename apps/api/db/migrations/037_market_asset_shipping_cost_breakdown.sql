ALTER TABLE market_asset_shipping_costs
  ADD COLUMN IF NOT EXISTS costs JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE market_asset_shipping_costs
SET costs = jsonb_build_object(
  '8-sheet', 0,
  '6-sheet', 0,
  '4-sheet', 0,
  '2-sheet', 0,
  'QA0', 0,
  'Mega', mega_shipping_rate,
  'DOT M', dot_m_shipping_rate,
  'MP', mp_shipping_rate,
  'FF', 0
)
WHERE costs = '{}'::jsonb;
