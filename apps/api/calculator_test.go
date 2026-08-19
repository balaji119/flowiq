package main

import "testing"

func TestDistributeBreakdownOverrideUsesExistingAssetWeights(t *testing.T) {
	lines := []campaignLineResult{
		{Breakdown: quantityBreakdown{"8-sheet": 8}},
		{Breakdown: quantityBreakdown{"8-sheet": 4}},
	}

	distributeBreakdownOverride(lines, []int{0, 1}, "8-sheet", 13)

	if got := lines[0].Breakdown["8-sheet"]; got != 9 {
		t.Fatalf("first asset quantity = %d, want 9", got)
	}
	if got := lines[1].Breakdown["8-sheet"]; got != 4 {
		t.Fatalf("second asset quantity = %d, want 4", got)
	}
}

func TestDistributeBreakdownOverrideAssignsNewFormatToFirstAsset(t *testing.T) {
	lines := []campaignLineResult{
		{Breakdown: quantityBreakdown{"Mega": 0}},
		{Breakdown: quantityBreakdown{"Mega": 0}},
	}

	distributeBreakdownOverride(lines, []int{0, 1}, "Mega", 3)

	if got := lines[0].Breakdown["Mega"]; got != 3 {
		t.Fatalf("first asset quantity = %d, want 3", got)
	}
	if got := lines[1].Breakdown["Mega"]; got != 0 {
		t.Fatalf("second asset quantity = %d, want 0", got)
	}
}

func TestCalculateFrameBreakdownDerivesFramesFromPosters(t *testing.T) {
	frames := calculateFrameBreakdown(quantityBreakdown{
		"8-sheet": 13,
		"6-sheet": 7,
		"4-sheet": 3,
		"2-sheet": 2,
		"QA0":     5,
	})

	want := quantityBreakdown{"8-sheet": 4, "6-sheet": 3, "4-sheet": 2, "2-sheet": 2, "QA0": 2}
	for key, expected := range want {
		if got := frames[key]; got != expected {
			t.Errorf("%s frames = %d, want %d", key, got, expected)
		}
	}
}

func TestCustomSheetIncludedInCampaignTotals(t *testing.T) {
	breakdown := quantityBreakdown{
		"Custom Sheet": 7,
		"8-sheet":      4,
		"Mega":         2,
	}

	if got := posterTotal(breakdown); got != 11 {
		t.Fatalf("poster total = %d, want 11", got)
	}
	if got := totalUnits(breakdown); got != 13 {
		t.Fatalf("total units = %d, want 13", got)
	}
}

func TestCalculateFrameBreakdownPreservesCustomSheetQuantity(t *testing.T) {
	frames := calculateFrameBreakdown(quantityBreakdown{
		"Custom Sheet": 7,
		"8-sheet":      5,
	})

	if got := frames["Custom Sheet"]; got != 7 {
		t.Fatalf("custom-sheet frames = %d, want 7", got)
	}
	if got := frames["8-sheet"]; got != 2 {
		t.Fatalf("8-sheet frames = %d, want 2", got)
	}
}

func TestUsesMaintenanceAssetForWeekAlternatesFromOddStart(t *testing.T) {
	if usesMaintenanceAssetForWeek(1, 1, true) {
		t.Fatal("week 1 should use the base asset for an odd-week start")
	}
	if !usesMaintenanceAssetForWeek(1, 2, true) {
		t.Fatal("week 2 should use the maintenance asset for an odd-week start")
	}
}

func TestUsesMaintenanceAssetForWeekAlternatesFromEvenStart(t *testing.T) {
	if usesMaintenanceAssetForWeek(2, 2, true) {
		t.Fatal("week 2 should use the base asset for an even-week start")
	}
	if !usesMaintenanceAssetForWeek(2, 3, true) {
		t.Fatal("week 3 should use the maintenance asset for an even-week start")
	}
}

func TestUsesMaintenanceAssetForWeekRequiresMaintenanceAsset(t *testing.T) {
	if usesMaintenanceAssetForWeek(2, 3, false) {
		t.Fatal("week should use the base asset when no maintenance asset is linked")
	}
}
