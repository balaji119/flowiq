const workbookMetadata = require('./workbookMetadata.json');
const formatKeys = ['8-sheet', '6-sheet', '4-sheet', '2-sheet', 'QA0', 'Mega', 'DOT M', 'MP'];

function createEmptyBreakdown() {
  return {
    '8-sheet': 0,
    '6-sheet': 0,
    '4-sheet': 0,
    '2-sheet': 0,
    QA0: 0,
    Mega: 0,
    'DOT M': 0,
    MP: 0,
  };
}

function posterTotal(breakdown) {
  return breakdown['8-sheet'] + breakdown['6-sheet'] + breakdown['4-sheet'] + breakdown['2-sheet'] + breakdown.QA0;
}

function frameTotal(breakdown) {
  return (
    breakdown['8-sheet'] / 4 +
    breakdown['6-sheet'] / 3 +
    breakdown['4-sheet'] / 2 +
    breakdown['2-sheet'] +
    breakdown.QA0 / 4
  );
}

function specialFormatTotal(breakdown) {
  return breakdown.Mega + breakdown['DOT M'] + breakdown.MP;
}

function totalUnits(breakdown) {
  return posterTotal(breakdown) + specialFormatTotal(breakdown);
}

function addBreakdown(target, source, multiplier = 1) {
  for (const key of formatKeys) {
    target[key] += (source[key] || 0) * multiplier;
  }
}

const assetLookup = new Map(
  workbookMetadata.flatMap((market) => market.assets.map((asset) => [asset.id, asset])),
);

function calculateCampaign(campaignLines = []) {
  const lineResults = [];
  const marketTotals = new Map(
    workbookMetadata.map((market) => [
      market.name,
      {
        market: market.name,
        breakdown: createEmptyBreakdown(),
        posterTotal: 0,
        frameTotal: 0,
        specialFormatTotal: 0,
        totalUnits: 0,
        activeAssets: 0,
        activeRuns: 0,
      },
    ]),
  );

  for (const line of campaignLines) {
    const asset = assetLookup.get(line.assetId);
    const selectedWeeks = Array.isArray(line.selectedWeeks) ? line.selectedWeeks.filter(Boolean) : [];
    const runCount = selectedWeeks.length;

    if (!asset || runCount === 0) {
      continue;
    }

    const breakdown = createEmptyBreakdown();
    addBreakdown(breakdown, asset.quantities, runCount);

    lineResults.push({
      id: line.id,
      market: asset.market,
      assetLabel: asset.label,
      state: asset.state,
      runCount,
      selectedWeeks,
      breakdown,
    });

    const totals = marketTotals.get(asset.market);
    addBreakdown(totals.breakdown, asset.quantities, runCount);
    totals.activeAssets += 1;
    totals.activeRuns += runCount;
  }

  const perMarket = Array.from(marketTotals.values()).map((entry) => ({
    ...entry,
    posterTotal: posterTotal(entry.breakdown),
    frameTotal: frameTotal(entry.breakdown),
    specialFormatTotal: specialFormatTotal(entry.breakdown),
    totalUnits: totalUnits(entry.breakdown),
  }));

  const grandBreakdown = createEmptyBreakdown();
  for (const market of perMarket) {
    addBreakdown(grandBreakdown, market.breakdown, 1);
  }

  return {
    lines: lineResults,
    perMarket,
    grandTotal: {
      market: 'All Markets',
      breakdown: grandBreakdown,
      posterTotal: posterTotal(grandBreakdown),
      frameTotal: frameTotal(grandBreakdown),
      specialFormatTotal: specialFormatTotal(grandBreakdown),
      totalUnits: totalUnits(grandBreakdown),
      activeAssets: perMarket.reduce((sum, market) => sum + market.activeAssets, 0),
      activeRuns: perMarket.reduce((sum, market) => sum + market.activeRuns, 0),
    },
  };
}

module.exports = {
  calculateCampaign,
  formatKeys,
  workbookMetadata,
};
