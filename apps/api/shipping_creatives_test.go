package main

import "testing"

func TestCustomSheetFlatFreightSharedPerMarket(t *testing.T) {
	for _, tc := range []struct {
		name       string
		flat       bool
		secondRate float64
		want       float64
	}{
		{"equal flat rates charged once", true, 84, 84},
		{"highest flat rate selected", true, 100, 100},
		{"zero rate does not suppress freight", true, 0, 84},
		{"box rates remain additive", false, 84, 252},
	} {
		t.Run(tc.name, func(t *testing.T) {
			values := orderFormValues{CampaignMarkets: []campaignMarket{{Market: "Sydney", Assets: []campaignAsset{
				{ID: "first", AssetID: "a", CreativeImageIDs: map[string]string{"Mega": "art"}},
				{ID: "second", AssetID: "b", CreativeImageIDs: map[string]string{"Mega": "art", "MP": "art"}},
				{ID: "unassigned", AssetID: "c"},
			}}}}
			summary := &campaignSummary{Lines: []campaignLineResult{
				{ID: "first", Market: "Sydney", Breakdown: quantityBreakdown{"Mega": 1}},
				{ID: "second", Market: "Sydney", Breakdown: quantityBreakdown{"Mega": 1, "MP": 1}},
				{ID: "unassigned", Market: "Sydney", Breakdown: quantityBreakdown{"Mega": 1}},
			}, PerMarket: []campaignTotals{{Market: "Sydney", Breakdown: quantityBreakdown{"Mega": 3, "MP": 1}}}}
			rates := []marketShippingRateRecord{{Market: "Sydney", UseFlatRateMegas: tc.flat, MegasPerBox: 1}}
			costs := []marketAssetShippingCostRecord{
				{Market: "Sydney", AssetID: "a", Costs: printingCostBreakdown{"mega": 84}},
				{Market: "Sydney", AssetID: "b", Costs: printingCostBreakdown{"mega": tc.secondRate, "mega-portrait": tc.secondRate}},
				{Market: "Sydney", AssetID: "c", Costs: printingCostBreakdown{"mega": 999}},
			}
			got := calculateCampaignShippingCost(values, summary, rates, costs, map[string]bool{"mega": true, "mega-portrait": true})
			if got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

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
