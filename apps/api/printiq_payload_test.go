package main

import "testing"

func TestResolvePrintIQSheetProductsUsesConfiguredOrderAndQuantities(t *testing.T) {
	values := orderFormValues{CampaignMarkets: []campaignMarket{{Market: "NSW", Assets: []campaignAsset{{ID: "asset-1"}}}}}
	summary := &campaignSummary{Lines: []campaignLineResult{{ID: "asset-1", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 40, "4-sheet": 10}}}}
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]string{
		"NSW": {
			"8-sheet": "NSW Quad Product",
			"4-sheet": "NSW Double Product",
		},
	}, map[string]string{
		"8-sheet": "Fallback Quad Product",
		"4-sheet": "Fallback Double Product",
	})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 2 {
		t.Fatalf("expected 2 products, got %d", len(products))
	}
	if products[0].ProductCode != "NSW Quad Product" || products[0].Quantity != 40 {
		t.Fatalf("unexpected first product: %#v", products[0])
	}
	if products[1].ProductCode != "NSW Double Product" || products[1].Quantity != 10 {
		t.Fatalf("unexpected second product: %#v", products[1])
	}
}

func TestResolvePrintIQSheetProductsRequiresEveryActiveProductCode(t *testing.T) {
	values := orderFormValues{CampaignMarkets: []campaignMarket{{Market: "NSW", Assets: []campaignAsset{{ID: "asset-1"}}}}}
	summary := &campaignSummary{Lines: []campaignLineResult{{ID: "asset-1", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 40, "4-sheet": 10}}}}
	if _, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]string{"NSW": map[string]string{"8-sheet": "Quad Product"}}, map[string]string{}); err == nil {
		t.Fatal("expected missing product code error")
	}
}

func TestResolvePrintIQSheetProductsSplitsQuantityByArtwork(t *testing.T) {
	values := orderFormValues{
		CampaignMarkets: []campaignMarket{
			{
				Assets: []campaignAsset{
					{
						ID: "asset-1",
						ArtworkMaterialAssignments: map[string][]artworkMaterialAssignment{
							"8-sheet": {
								{ArtworkImageID: "artwork-a", FrameCount: 15},
								{ArtworkImageID: "artwork-b", FrameCount: 10},
							},
						},
					},
				},
			},
		},
	}
	summary := &campaignSummary{Lines: []campaignLineResult{{ID: "asset-1", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 100}}}}
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]string{}, map[string]string{"8-sheet": "Quad Product"})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 2 || products[0].Quantity != 60 || products[0].ArtworkImageID != "artwork-a" || products[1].Quantity != 40 || products[1].ArtworkImageID != "artwork-b" {
		t.Fatalf("unexpected split products: %#v", products)
	}
}

func TestResolvePrintIQArtworkURLPrefersPageArtworkOverSourcePDF(t *testing.T) {
	artworkURL, err := (&app{}).resolvePrintIQArtworkURL(t.Context(), campaignPrintImage{
		StoredName:          "page-1.jpg",
		ImageURL:            "https://cdn.example.com/page-1.jpg",
		SourcePDFStoredName: "source.pdf",
		SourcePDFURL:        "https://cdn.example.com/source.pdf",
	})
	if err != nil {
		t.Fatalf("resolve artwork URL: %v", err)
	}
	if artworkURL != "https://cdn.example.com/page-1.jpg" {
		t.Fatalf("expected page artwork URL, got %s", artworkURL)
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

func TestExtractAcceptedProductsPreservesProductOrder(t *testing.T) {
	response := map[string]any{
		"AcceptanceDetails": map[string]any{
			"Products": []any{
				map[string]any{"JobNo": "J29328-01", "MiddlewareProductDetail": map[string]any{"Sections": []any{map[string]any{"QSTKey": float64(1)}}}},
				map[string]any{"JobNo": "J29328-02", "MiddlewareProductDetail": map[string]any{"Sections": []any{map[string]any{"QSTKey": float64(2)}}}},
			},
		},
	}
	products := extractAcceptedProducts(response)
	if len(products) != 2 || products[0].JobNo != "J29328-01" || products[1].JobNo != "J29328-02" {
		t.Fatalf("unexpected accepted products: %#v", products)
	}
}
