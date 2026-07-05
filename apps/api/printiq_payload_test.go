package main

import "testing"

func TestResolvePrintIQSheetProductsUsesConfiguredOrderAndQuantities(t *testing.T) {
	summary := &campaignSummary{GrandTotal: campaignTotals{Breakdown: quantityBreakdown{
		"8-sheet": 40,
		"4-sheet": 10,
	}}}
	products, err := resolvePrintIQSheetProducts(summary, map[string]string{
		"8-sheet": "Quad Product",
		"4-sheet": "Double Product",
	})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 2 {
		t.Fatalf("expected 2 products, got %d", len(products))
	}
	if products[0].ProductCode != "Quad Product" || products[0].Quantity != 40 {
		t.Fatalf("unexpected first product: %#v", products[0])
	}
	if products[1].ProductCode != "Double Product" || products[1].Quantity != 10 {
		t.Fatalf("unexpected second product: %#v", products[1])
	}
}

func TestResolvePrintIQSheetProductsRequiresEveryActiveProductCode(t *testing.T) {
	summary := &campaignSummary{GrandTotal: campaignTotals{Breakdown: quantityBreakdown{
		"8-sheet": 40,
		"4-sheet": 10,
	}}}
	if _, err := resolvePrintIQSheetProducts(summary, map[string]string{"8-sheet": "Quad Product"}); err == nil {
		t.Fatal("expected missing product code error")
	}
}

func TestBuildPrintIQGetPriceForProductPayload(t *testing.T) {
	payload := buildPrintIQGetPriceForProductPayload(
		printIQSheetProduct{ProductCode: "Double Product", Quantity: 10},
		"Q50206",
		"C00003",
	)
	if payload["ProductCode"] != "Double Product" || payload["QuoteNo"] != "Q50206" || payload["CustomerCode"] != "C00003" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
	quantities, ok := payload["Quantities"].([]map[string]any)
	if !ok || len(quantities) != 1 || quantities[0]["Quantity"] != 10 || quantities[0]["Kinds"] != 1 {
		t.Fatalf("unexpected quantities: %#v", payload["Quantities"])
	}
}
