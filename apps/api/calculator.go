package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

var formatKeys = []string{"8-sheet", "6-sheet", "4-sheet", "2-sheet", "QA0", "Mega", "DOT M", "MP"}

//go:embed workbookMetadata.json
var workbookMetadataBytes []byte

type calculatorService struct {
	markets     []marketMetadata
	assetLookup map[string]marketAssetOption
}

func newCalculatorService() (*calculatorService, error) {
	var markets []marketMetadata
	if err := json.Unmarshal(workbookMetadataBytes, &markets); err != nil {
		return nil, fmt.Errorf("parse workbook metadata: %w", err)
	}

	lookup := make(map[string]marketAssetOption)
	for _, market := range markets {
		for _, asset := range market.Assets {
			lookup[asset.ID] = asset
		}
	}

	return &calculatorService{
		markets:     markets,
		assetLookup: lookup,
	}, nil
}

func createEmptyBreakdown() quantityBreakdown {
	breakdown := quantityBreakdown{}
	for _, key := range formatKeys {
		breakdown[key] = 0
	}
	return breakdown
}

func addBreakdown(target, source quantityBreakdown, multiplier int) {
	for _, key := range formatKeys {
		target[key] += source[key] * multiplier
	}
}

func posterTotal(breakdown quantityBreakdown) int {
	return breakdown["8-sheet"] + breakdown["6-sheet"] + breakdown["4-sheet"] + breakdown["2-sheet"] + breakdown["QA0"]
}

func frameTotal(breakdown quantityBreakdown) int {
	return breakdown["8-sheet"]/4 + breakdown["6-sheet"]/3 + breakdown["4-sheet"]/2 + breakdown["2-sheet"] + breakdown["QA0"]/4
}

func specialFormatTotal(breakdown quantityBreakdown) int {
	return breakdown["Mega"] + breakdown["DOT M"] + breakdown["MP"]
}

func totalUnits(breakdown quantityBreakdown) int {
	return posterTotal(breakdown) + specialFormatTotal(breakdown)
}

func (c *calculatorService) calculateCampaign(lines []campaignLine) campaignSummary {
	lineResults := make([]campaignLineResult, 0)
	perMarketMap := make(map[string]*campaignTotals, len(c.markets))

	for _, market := range c.markets {
		perMarketMap[market.Name] = &campaignTotals{
			Market:    market.Name,
			Breakdown: createEmptyBreakdown(),
		}
	}

	for _, line := range lines {
		asset, ok := c.assetLookup[line.AssetID]
		if !ok {
			continue
		}

		selectedWeeks := make([]int, 0, len(line.SelectedWeeks))
		for _, week := range line.SelectedWeeks {
			if week > 0 {
				selectedWeeks = append(selectedWeeks, week)
			}
		}
		runCount := len(selectedWeeks)
		if runCount == 0 {
			continue
		}

		breakdown := createEmptyBreakdown()
		addBreakdown(breakdown, asset.Quantities, runCount)

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
		addBreakdown(totals.Breakdown, asset.Quantities, runCount)
		totals.ActiveAssets++
		totals.ActiveRuns += runCount
	}

	perMarket := make([]campaignTotals, 0, len(c.markets))
	grandBreakdown := createEmptyBreakdown()
	totalAssets := 0
	totalRuns := 0

	for _, market := range c.markets {
		entry := perMarketMap[market.Name]
		entry.PosterTotal = posterTotal(entry.Breakdown)
		entry.FrameTotal = frameTotal(entry.Breakdown)
		entry.SpecialFormatTotal = specialFormatTotal(entry.Breakdown)
		entry.TotalUnits = totalUnits(entry.Breakdown)
		addBreakdown(grandBreakdown, entry.Breakdown, 1)
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
			PosterTotal:        posterTotal(grandBreakdown),
			FrameTotal:         frameTotal(grandBreakdown),
			SpecialFormatTotal: specialFormatTotal(grandBreakdown),
			TotalUnits:         totalUnits(grandBreakdown),
			ActiveAssets:       totalAssets,
			ActiveRuns:         totalRuns,
		},
	}
}
