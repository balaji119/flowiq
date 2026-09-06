CREATE TABLE IF NOT EXISTS market_printing_costs (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  poster_cost NUMERIC NOT NULL DEFAULT 0 CHECK (poster_cost >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, market_id)
);

WITH asset_poster_costs AS (
  SELECT
    tenant_id,
    market_id,
    GREATEST(
      COALESCE((costs->>'8-sheet')::numeric, 0),
      COALESCE((costs->>'6-sheet')::numeric, 0),
      COALESCE((costs->>'4-sheet')::numeric, 0),
      COALESCE((costs->>'2-sheet')::numeric, 0),
      COALESCE((costs->>'QA0')::numeric, 0)
    ) AS poster_cost
  FROM market_asset_printing_costs
),
market_poster_costs AS (
  SELECT tenant_id, market_id, MAX(poster_cost) AS poster_cost
  FROM asset_poster_costs
  GROUP BY tenant_id, market_id
)
INSERT INTO market_printing_costs (tenant_id, market_id, poster_cost, created_at, updated_at)
SELECT tenant_id, market_id, poster_cost, NOW(), NOW()
FROM market_poster_costs
WHERE poster_cost > 0
ON CONFLICT (tenant_id, market_id)
DO UPDATE SET poster_cost = EXCLUDED.poster_cost, updated_at = NOW();

UPDATE market_asset_printing_costs
SET costs = costs - '8-sheet' - '6-sheet' - '4-sheet' - '2-sheet' - 'QA0',
    updated_at = NOW()
WHERE costs ?| ARRAY['8-sheet', '6-sheet', '4-sheet', '2-sheet', 'QA0'];
