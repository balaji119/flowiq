package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/jung-kurt/gofpdf"
)

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

func TestResolvePrintIQArtworkURLExtractsSourcePDFPage(t *testing.T) {
	tempDir := t.TempDir()
	sourcePDF := gofpdf.New("P", "pt", "A4", "")
	sourcePDF.AddPage()
	sourcePDF.Text(20, 20, "page 1")
	sourcePDF.AddPage()
	sourcePDF.Text(20, 20, "page 2")
	if err := sourcePDF.OutputFileAndClose(filepath.Join(tempDir, "source.pdf")); err != nil {
		t.Fatalf("create source pdf: %v", err)
	}

	pageImage := image.NewRGBA(image.Rect(0, 0, 20, 10))
	for y := 0; y < 10; y += 1 {
		for x := 0; x < 20; x += 1 {
			pageImage.Set(x, y, color.RGBA{R: 120, G: 30, B: 200, A: 255})
		}
	}
	pageFile, err := os.Create(filepath.Join(tempDir, "page-1.png"))
	if err != nil {
		t.Fatalf("create page image: %v", err)
	}
	if err := png.Encode(pageFile, pageImage); err != nil {
		t.Fatalf("encode page image: %v", err)
	}
	if err := pageFile.Close(); err != nil {
		t.Fatalf("close page image: %v", err)
	}

	t.Setenv("APP_BASE_URL", "https://app.example.com")
	artworkURL, err := (&app{campaignImageDir: tempDir}).resolvePrintIQArtworkURL(t.Context(), campaignPrintImage{
		StoredName:          "page-1.png",
		ImageURL:            "https://cdn.example.com/page-1.png",
		SourcePDFPageNumber: 2,
		SourcePDFPageCount:  2,
		SourcePDFStoredName: "source.pdf",
		SourcePDFURL:        "https://cdn.example.com/source.pdf",
	})
	if err != nil {
		t.Fatalf("resolve artwork URL: %v", err)
	}
	if artworkURL != "https://app.example.com/api/campaign-images/source-page-0002-printiq.pdf/download" {
		t.Fatalf("expected page artwork PDF URL, got %s", artworkURL)
	}
	if _, err := os.Stat(filepath.Join(tempDir, "source-page-0002-printiq.pdf")); err != nil {
		t.Fatalf("expected generated PDF: %v", err)
	}
}

func TestResolveArtworkSourcePageNumberRequiresPageSignalUnlessSinglePage(t *testing.T) {
	pageNumber := resolveArtworkSourcePageNumber(campaignPrintImage{
		Name: "CRTV-26903_SFL_Rev360_QLD_BRUNSWICK_MEGA_4200x2890_@25_HR",
	})
	if pageNumber != 0 {
		t.Fatalf("expected missing page signal, got %d", pageNumber)
	}

	pageNumber = resolveArtworkSourcePageNumber(campaignPrintImage{
		Name:               "CRTV-26903_SFL_Rev360_QLD_BRUNSWICK_MEGA_4200x2890_@25_HR",
		SourcePDFPageCount: 1,
	})
	if pageNumber != 1 {
		t.Fatalf("expected single page source to use page 1, got %d", pageNumber)
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
