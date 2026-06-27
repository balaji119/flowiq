package main

import (
	"context"
	"sort"
	"strings"
)

var formatKeys = []string{"8-sheet", "6-sheet", "4-sheet", "2-sheet", "QA0", "Mega", "DOT M", "MP", "FF"}

type calculatorService struct {
	mappings *mappingStore
}

func newCalculatorService(mappings *mappingStore) *calculatorService {
	return &calculatorService{mappings: mappings}
}

func createAssetLookup(markets []marketMetadata) map[string]marketAssetOption {
	lookup := make(map[string]marketAssetOption)
	for _, market := range markets {
		for _, asset := range market.Assets {
			lookup[asset.ID] = asset
		}
	}
	return lookup
}

func createEmptyBreakdown() quantityBreakdown {
	breakdown := quantityBreakdown{}
	for _, key := range formatKeys {
		breakdown[key] = 0
	}
	return breakdown
}

func cloneQuantityBreakdown(source quantityBreakdown) quantityBreakdown {
	cloned := quantityBreakdown{}
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func calculateFrameBreakdown(breakdown quantityBreakdown) quantityBreakdown {
	frames := cloneQuantityBreakdown(breakdown)
	frames["8-sheet"] = (breakdown["8-sheet"] + 3) / 4
	frames["6-sheet"] = (breakdown["6-sheet"] + 2) / 3
	frames["4-sheet"] = (breakdown["4-sheet"] + 1) / 2
	frames["2-sheet"] = breakdown["2-sheet"]
	frames["QA0"] = (breakdown["QA0"] + 3) / 4
	return frames
}

func applyBreakdownOverrides(target quantityBreakdown, overrides quantityBreakdown) {
	for key, value := range overrides {
		if strings.TrimSpace(key) == "" {
			continue
		}
		if value < 0 {
			value = 0
		}
		target[key] = value
	}
}

func sumBreakdown(breakdown quantityBreakdown) int {
	total := 0
	for _, value := range breakdown {
		total += value
	}
	return total
}

func addBreakdown(target, source quantityBreakdown, multiplier int) {
	for key, value := range source {
		target[key] += value * multiplier
	}
}

func posterTotal(breakdown quantityBreakdown) int {
	return breakdown["8-sheet"] + breakdown["6-sheet"] + breakdown["4-sheet"] + breakdown["2-sheet"] + breakdown["QA0"]
}

func frameTotal(breakdown quantityBreakdown) int {
	return breakdown["8-sheet"]/4 + breakdown["6-sheet"]/3 + breakdown["4-sheet"]/2 + breakdown["2-sheet"] + breakdown["QA0"]/4
}

func specialFormatTotal(breakdown quantityBreakdown) int {
	return breakdown["Mega"] + breakdown["DOT M"] + breakdown["MP"] + breakdown["FF"]
}

func totalUnits(breakdown quantityBreakdown) int {
	return posterTotal(breakdown) + specialFormatTotal(breakdown)
}

func (c *calculatorService) loadMarkets(tenantID string) ([]marketMetadata, error) {
	return c.mappings.listMarketMetadata(context.Background(), tenantID)
}

func (c *calculatorService) calculateCampaign(tenantID string, lines []campaignLine) (campaignSummary, error) {
	markets, err := c.loadMarkets(tenantID)
	if err != nil {
		return campaignSummary{}, err
	}

	lineResults := make([]campaignLineResult, 0)
	perMarketMap := make(map[string]*campaignTotals, len(markets))
	assetLookup := createAssetLookup(markets)
	marketOverrides := make(map[string]*campaignQuantityOverrides)

	for _, market := range markets {
		perMarketMap[market.Name] = &campaignTotals{
			Market:    market.Name,
			Breakdown: createEmptyBreakdown(),
		}
	}

	for _, line := range lines {
		if line.MarketQuantityOverrides != nil {
			marketOverrides[line.Market] = line.MarketQuantityOverrides
		}
		asset, ok := assetLookup[line.AssetID]
		if !ok {
			continue
		}

		selectedWeeks := make([]int, 0, len(line.SelectedWeeks))
		for _, week := range line.SelectedWeeks {
			if week > 0 {
				selectedWeeks = append(selectedWeeks, week)
			}
		}
		sort.Ints(selectedWeeks)
		runCount := len(selectedWeeks)
		if runCount == 0 {
			continue
		}

		breakdown := createEmptyBreakdown()
		for _, week := range selectedWeeks {
			runAsset := asset
			// Maintenance runs are based on the actual campaign week number (every even week),
			// not on the ordinal position inside the filtered selected week list.
			if week%2 == 0 && asset.MaintenanceAssetID != nil {
				if maintenance, maintenanceFound := assetLookup[*asset.MaintenanceAssetID]; maintenanceFound {
					runAsset = maintenance
				}
			}
			addBreakdown(breakdown, runAsset.Quantities, 1)
		}

		lineResults = append(lineResults, campaignLineResult{
			ID:            line.ID,
			Market:        asset.Market,
			AssetLabel:    asset.Label,
			State:         asset.State,
			RunCount:      runCount,
			SelectedWeeks: selectedWeeks,
			Breakdown:     breakdown,
		})

		totals := perMarketMap[asset.Market]
		addBreakdown(totals.Breakdown, breakdown, 1)
		totals.ActiveAssets++
		totals.ActiveRuns += runCount
	}

	perMarket := make([]campaignTotals, 0, len(markets))
	grandBreakdown := createEmptyBreakdown()
	grandFrameBreakdown := createEmptyBreakdown()
	totalAssets := 0
	totalRuns := 0

	for _, market := range markets {
		entry := perMarketMap[market.Name]
		if overrides := marketOverrides[market.Name]; overrides != nil {
			applyBreakdownOverrides(entry.Breakdown, overrides.Posters)
		}
		entry.FrameBreakdown = calculateFrameBreakdown(entry.Breakdown)
		if overrides := marketOverrides[market.Name]; overrides != nil {
			applyBreakdownOverrides(entry.FrameBreakdown, overrides.Frames)
		}
		entry.PosterTotal = posterTotal(entry.Breakdown)
		entry.FrameTotal = sumBreakdown(entry.FrameBreakdown)
		entry.SpecialFormatTotal = specialFormatTotal(entry.Breakdown)
		entry.TotalUnits = totalUnits(entry.Breakdown)
		addBreakdown(grandBreakdown, entry.Breakdown, 1)
		addBreakdown(grandFrameBreakdown, entry.FrameBreakdown, 1)
		totalAssets += entry.ActiveAssets
		totalRuns += entry.ActiveRuns
		perMarket = append(perMarket, *entry)
	}

	return campaignSummary{
		Lines:     lineResults,
		PerMarket: perMarket,
		GrandTotal: campaignTotals{
			Market:             "All Markets",
			Breakdown:          grandBreakdown,
			FrameBreakdown:     grandFrameBreakdown,
			PosterTotal:        posterTotal(grandBreakdown),
			FrameTotal:         sumBreakdown(grandFrameBreakdown),
			SpecialFormatTotal: specialFormatTotal(grandBreakdown),
			TotalUnits:         totalUnits(grandBreakdown),
			ActiveAssets:       totalAssets,
			ActiveRuns:         totalRuns,
		},
	}, nil
}
