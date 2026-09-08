package main

import "testing"

func TestShippingExcludesUnassignedFormatsAndLines(t *testing.T) {
	values := orderFormValues{CampaignMarkets: []campaignMarket{{Market: "VIC", Assets: []campaignAsset{
		{ID: "assigned", CreativeImageID: "art"}, {ID: "unassigned"},
	}}}}
	summary := &campaignSummary{Lines: []campaignLineResult{
		{ID: "assigned", Market: "VIC", Breakdown: quantityBreakdown{"8-sheet": 40, "6-sheet": 30, "Mega": 5}},
		{ID: "unassigned", Market: "VIC", Breakdown: quantityBreakdown{"8-sheet": 40}},
	}, PerMarket: []campaignTotals{{Market: "VIC", Breakdown: quantityBreakdown{"8-sheet": 80, "6-sheet": 30, "Mega": 5}}}}
	for _, flat := range []bool{false, true} {
		rates := []marketShippingRateRecord{{Market: "VIC", UseFlatRateSheeters: flat, EightSheeterPrice: 25, EightSheeterSetsPerBox: 10, SixSheeterPrice: 90, SixSheeterSetsPerBox: 1, MegaShippingRate: 100}}
		got := calculateCampaignShippingCost(values, summary, rates, nil, map[string]bool{"mega": true})
		if got != 25 {
			t.Fatalf("flat=%v: expected assigned quad shipping only, got %v", flat, got)
		}
		withoutCreative := values
		withoutCreative.CampaignMarkets = []campaignMarket{{Market: "VIC", Assets: []campaignAsset{{ID: "assigned"}, {ID: "unassigned"}}}}
		if got := calculateCampaignShippingCost(withoutCreative, summary, rates, nil, nil); got != 0 {
			t.Fatalf("unassigned lines must have no shipping: %v", got)
		}
	}
	if summary.Lines[0].Breakdown["6-sheet"] != 30 {
		t.Fatal("shipping filter changed the campaign summary")
	}
}

func TestShippingCreativeAssignmentPrecedence(t *testing.T) {
	asset := campaignAsset{CreativeImageID: "legacy", ArtworkMaterialAssignments: map[string][]artworkMaterialAssignment{"8-sheet": {{ArtworkImageID: " ", FrameCount: 2}}}}
	if shippingFormatHasCreative(asset, "8-sheet") || shippingFormatHasCreative(asset, "6-sheet") {
		t.Fatal("invalid explicit assignment must not fall back to legacy creative")
	}
	asset.ArtworkMaterialAssignments["8-sheet"] = []artworkMaterialAssignment{{ArtworkImageID: "art", FrameCount: 2}}
	if !shippingFormatHasCreative(asset, "8-sheet") {
		t.Fatal("valid assignment must qualify")
	}
}
