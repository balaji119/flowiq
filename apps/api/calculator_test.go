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
