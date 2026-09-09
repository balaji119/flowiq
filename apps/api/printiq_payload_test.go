package main

import (
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jung-kurt/gofpdf"
)

func testMaterialProductMapping(productCode string, sheetCode ...string) materialProductMapping {
	mapping := materialProductMapping{ProductCode: productCode}
	if len(sheetCode) > 0 {
		mapping.SheetCode = sheetCode[0]
	}
	return mapping
}

func TestResolvePrintIQSheetProductsUsesConfiguredOrderAndFrameQuantities(t *testing.T) {
	values := orderFormValues{CampaignMarkets: []campaignMarket{{Market: "NSW", Assets: []campaignAsset{{ID: "asset-1", CreativeImageIDs: map[string]string{"8-sheet": "artwork-a", "4-sheet": "artwork-b"}}}}}}
	summary := &campaignSummary{Lines: []campaignLineResult{{ID: "asset-1", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 40, "4-sheet": 10}}}}
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{
		"NSW": {
			"8-sheet": testMaterialProductMapping("NSW Quad Product", "SHT-QUAD"),
			"4-sheet": testMaterialProductMapping("NSW Double Product"),
		},
	}, map[string]string{
		"8-sheet": "Fallback Quad Product",
		"4-sheet": "Fallback Double Product",
	}, map[string]bool{})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 2 {
		t.Fatalf("expected 2 products, got %d", len(products))
	}
	if products[0].ProductCode != "NSW Quad Product" || products[0].SheetCode != "SHT-QUAD" || products[0].Quantity != 10 {
		t.Fatalf("unexpected first product: %#v", products[0])
	}
	if products[1].ProductCode != "NSW Double Product" || products[1].Quantity != 5 {
		t.Fatalf("unexpected second product: %#v", products[1])
	}
}

func TestResolvePrintIQSheetProductsOrdersByCreativeNumber(t *testing.T) {
	values := orderFormValues{
		CreativeNameAssignments: map[string]string{
			"Creative1": "artwork-c1",
			"Creative2": "artwork-c2",
		},
		CampaignMarkets: []campaignMarket{{
			Market: "NSW",
			Assets: []campaignAsset{{
				ID:               "asset-1",
				CreativeImageIDs: map[string]string{"8-sheet": "artwork-c2", "4-sheet": "artwork-c1"},
			}},
		}},
	}
	summary := &campaignSummary{Lines: []campaignLineResult{{ID: "asset-1", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 40, "4-sheet": 10}}}}
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{
		"NSW": {
			"8-sheet": testMaterialProductMapping("NSW Quad Product"),
			"4-sheet": testMaterialProductMapping("NSW Double Product"),
		},
	}, map[string]string{}, map[string]bool{})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 2 {
		t.Fatalf("expected 2 products, got %d", len(products))
	}
	if products[0].ArtworkImageID != "artwork-c1" || products[0].FormatKey != "4-sheet" {
		t.Fatalf("expected Creative1 product first, got %#v", products[0])
	}
	if products[1].ArtworkImageID != "artwork-c2" || products[1].FormatKey != "8-sheet" {
		t.Fatalf("expected Creative2 product second, got %#v", products[1])
	}
}

func TestResolvePrintIQSheetProductsRequiresEveryActiveProductCode(t *testing.T) {
	values := orderFormValues{CampaignMarkets: []campaignMarket{{Market: "NSW", Assets: []campaignAsset{{ID: "asset-1"}}}}}
	summary := &campaignSummary{Lines: []campaignLineResult{{ID: "asset-1", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 40, "4-sheet": 10}}}}
	if _, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{
		"NSW": {
			"8-sheet": testMaterialProductMapping("Quad Product"),
		},
	}, map[string]string{}, map[string]bool{}); err == nil {
		t.Fatal("expected missing product code error")
	} else if !strings.Contains(err.Error(), "market NSW") || !strings.Contains(err.Error(), "format 4-sheet") {
		t.Fatalf("expected market and format in error, got %q", err.Error())
	}
}

func TestResolvePrintIQSheetProductsMissingCustomProductCodeIncludesAsset(t *testing.T) {
	values := orderFormValues{CampaignMarkets: []campaignMarket{{Market: "NSW", Assets: []campaignAsset{{ID: "asset-1"}}}}}
	summary := &campaignSummary{Lines: []campaignLineResult{{ID: "asset-1", Market: "NSW", AssetLabel: "Central Station", Breakdown: quantityBreakdown{"Mega": 1}}}}
	if _, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{}, map[string]string{"mega": "Legacy Mega Product"}, map[string]bool{"mega": true}); err == nil {
		t.Fatal("expected missing custom product code error")
	} else if !strings.Contains(err.Error(), "market NSW") || !strings.Contains(err.Error(), "format Mega") || !strings.Contains(err.Error(), "asset Central Station") {
		t.Fatalf("expected market, format, and asset in error, got %q", err.Error())
	}
}

func TestResolvePrintIQSheetProductsSplitsFrameQuantityByArtwork(t *testing.T) {
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
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{}, map[string]string{"8-sheet": "Quad Product"}, map[string]bool{})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 2 || products[0].Quantity != 15 || products[0].ArtworkImageID != "artwork-a" || products[1].Quantity != 10 || products[1].ArtworkImageID != "artwork-b" {
		t.Fatalf("unexpected split products: %#v", products)
	}
}

func TestResolvePrintIQSheetProductsMergesSameMarketArtworkAndSheetType(t *testing.T) {
	values := orderFormValues{
		CampaignMarkets: []campaignMarket{
			{
				Market: "NSW",
				Assets: []campaignAsset{
					{ID: "asset-1", CreativeImageIDs: map[string]string{"8-sheet": "artwork-a"}},
					{ID: "asset-2", CreativeImageIDs: map[string]string{"8-sheet": "artwork-a"}},
				},
			},
		},
	}
	summary := &campaignSummary{Lines: []campaignLineResult{
		{ID: "asset-1", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 40}},
		{ID: "asset-2", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 20}},
	}}
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{
		"NSW": {
			"8-sheet": testMaterialProductMapping("NSW Quad Product", "SHT-QUAD"),
		},
	}, map[string]string{}, map[string]bool{})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 1 {
		t.Fatalf("expected 1 merged product, got %d: %#v", len(products), products)
	}
	if products[0].Market != "NSW" || products[0].FormatKey != "8-sheet" || products[0].ProductCode != "NSW Quad Product" || products[0].SheetCode != "SHT-QUAD" || products[0].Quantity != 15 || products[0].ArtworkImageID != "artwork-a" {
		t.Fatalf("unexpected merged product: %#v", products[0])
	}
}

func TestResolvePrintIQSheetProductsKeepsDifferentDeliveryAddressesSeparate(t *testing.T) {
	values := orderFormValues{
		CampaignMarkets: []campaignMarket{
			{
				Market: "NSW",
				Assets: []campaignAsset{
					{ID: "asset-1", CreativeImageIDs: map[string]string{"8-sheet": "artwork-a"}, DeliveryAddress: "Sydney Warehouse\n10 George St\nSydney NSW 2000\nPhone: 02 1111 1111\nAustralia"},
					{ID: "asset-2", CreativeImageIDs: map[string]string{"8-sheet": "artwork-a"}, DeliveryAddress: "Parramatta Depot\n20 Church St\nParramatta NSW 2150\nPhone: 02 2222 2222\nAustralia"},
				},
			},
		},
	}
	summary := &campaignSummary{Lines: []campaignLineResult{
		{ID: "asset-1", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 40}},
		{ID: "asset-2", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 20}},
	}}
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{
		"NSW": {
			"8-sheet": testMaterialProductMapping("NSW Quad Product", "SHT-QUAD"),
		},
	}, map[string]string{}, map[string]bool{})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 2 {
		t.Fatalf("expected different delivery addresses to remain separate, got %d: %#v", len(products), products)
	}
	if products[0].Quantity != 10 || !strings.Contains(products[0].DeliveryAddress, "Sydney Warehouse") {
		t.Fatalf("unexpected first delivery product: %#v", products[0])
	}
	if products[1].Quantity != 5 || !strings.Contains(products[1].DeliveryAddress, "Parramatta Depot") {
		t.Fatalf("unexpected second delivery product: %#v", products[1])
	}
}

func TestCalculateCampaignShippingCostMatchesReviewTotal(t *testing.T) {
	values := orderFormValues{
		CampaignMarkets: []campaignMarket{
			{
				Market: "NSW",
				Assets: []campaignAsset{
					{ID: "asset-1", AssetID: "market-asset-1", CreativeImageIDs: map[string]string{"8-sheet": "art", "6-sheet": "art", "Mini Mega": "art"}},
				},
			},
		},
	}
	summary := &campaignSummary{
		Lines: []campaignLineResult{
			{ID: "asset-1", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 40, "6-sheet": 7, "Mini Mega": 3}},
		},
		PerMarket: []campaignTotals{
			{Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 40, "6-sheet": 7, "Mini Mega": 3}},
			{Market: "VIC", Breakdown: quantityBreakdown{"8-sheet": 100}},
		},
	}

	total := calculateCampaignShippingCost(
		values,
		summary,
		[]marketShippingRateRecord{
			{Market: "NSW", SixSheeterPrice: 30, SixSheeterSetsPerBox: 2, EightSheeterPrice: 25, EightSheeterSetsPerBox: 10, MegasPerBox: 2},
			{Market: "VIC", EightSheeterPrice: 999, EightSheeterSetsPerBox: 1},
		},
		[]marketAssetShippingCostRecord{
			{Market: "NSW", AssetID: "market-asset-1", Costs: printingCostBreakdown{"mini-mega": 90}},
		},
		map[string]bool{"mini-mega": true},
	)

	if total != 265 {
		t.Fatalf("expected shipping total 265, got %#v", total)
	}
}

func TestCalculateCampaignShippingCostUsesSplitFlatRateFlags(t *testing.T) {
	values := orderFormValues{
		CampaignMarkets: []campaignMarket{{
			Market: "NSW",
			Assets: []campaignAsset{{ID: "asset-1", AssetID: "market-asset-1", CreativeImageIDs: map[string]string{"8-sheet": "art", "6-sheet": "art", "Mini Mega": "art"}}},
		}},
	}
	summary := &campaignSummary{
		Lines: []campaignLineResult{
			{ID: "asset-1", Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 1, "Mini Mega": 3}},
		},
		PerMarket: []campaignTotals{
			{Market: "NSW", Breakdown: quantityBreakdown{"8-sheet": 1, "Mini Mega": 3}},
		},
	}

	total := calculateCampaignShippingCost(
		values,
		summary,
		[]marketShippingRateRecord{{Market: "NSW", UseFlatRate: true, UseFlatRateSheeters: true, UseFlatRateMegas: false, EightSheeterPrice: 25, MegasPerBox: 2}},
		[]marketAssetShippingCostRecord{{Market: "NSW", AssetID: "market-asset-1", Costs: printingCostBreakdown{"mini-mega": 90}}},
		map[string]bool{"mini-mega": true},
	)

	if total != 205 {
		t.Fatalf("expected split flat-rate shipping total 205, got %#v", total)
	}
}

func TestResolvePrintIQSheetProductsIncludesDynamicCustomSheetKeys(t *testing.T) {
	values := orderFormValues{
		CampaignMarkets: []campaignMarket{
			{
				Market: "VIC",
				Assets: []campaignAsset{
					{ID: "asset-1", CreativeImageIDs: map[string]string{"Mini Mega": "artwork-8"}},
					{ID: "asset-2", CreativeImageIDs: map[string]string{"Mini Mega": "artwork-8"}},
				},
			},
		},
	}
	summary := &campaignSummary{Lines: []campaignLineResult{
		{ID: "asset-1", Market: "VIC", AssetLabel: "DOM - Brunton Ave", Breakdown: quantityBreakdown{"Mini Mega": 4}},
		{ID: "asset-2", Market: "VIC", AssetLabel: "DOM - Brunton Ave", Breakdown: quantityBreakdown{"Mini Mega": 2}},
	}}
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{
		"VIC": {
			"asset:asset-1|sheet:mini-mega": testMaterialProductMapping("Mini Mega Brunton", "SHT-MINI"),
			"asset:asset-2|sheet:mini-mega": testMaterialProductMapping("Mini Mega Brunton", "SHT-MINI"),
		},
	}, map[string]string{}, map[string]bool{"mini-mega": true})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 1 {
		t.Fatalf("expected 1 merged mini mega product, got %d: %#v", len(products), products)
	}
	if products[0].Market != "VIC" || products[0].FormatKey != "Mini Mega" || products[0].ProductCode != "Mini Mega Brunton" || products[0].SheetCode != "SHT-MINI" || products[0].Quantity != 6 || products[0].ArtworkImageID != "artwork-8" {
		t.Fatalf("unexpected dynamic custom product: %#v", products[0])
	}
}

func TestResolvePrintIQSheetProductsSkipsQuantitiesWithoutArtwork(t *testing.T) {
	values := orderFormValues{
		CampaignMarkets: []campaignMarket{
			{
				Market: "VIC",
				Assets: []campaignAsset{
					{ID: "asset-with-artwork", CreativeImageIDs: map[string]string{"8-sheet": "artwork-a"}},
					{ID: "asset-without-artwork"},
				},
			},
		},
	}
	summary := &campaignSummary{Lines: []campaignLineResult{
		{ID: "asset-with-artwork", Market: "VIC", Breakdown: quantityBreakdown{"8-sheet": 8}},
		{ID: "asset-without-artwork", Market: "VIC", Breakdown: quantityBreakdown{"8-sheet": 8}},
	}}
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{
		"VIC": {
			"8-sheet": testMaterialProductMapping("VIC Quad Product"),
		},
	}, map[string]string{}, map[string]bool{})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 1 {
		t.Fatalf("expected only artwork-mapped product, got %d: %#v", len(products), products)
	}
	if products[0].Quantity != 2 || products[0].ArtworkImageID != "artwork-a" {
		t.Fatalf("unexpected artwork-mapped product: %#v", products[0])
	}
}

func TestResolvePrintIQSheetProductsUsesAssetCodeForCustomSheetSize(t *testing.T) {
	values := orderFormValues{CampaignMarkets: []campaignMarket{{Market: "NSW", Assets: []campaignAsset{{ID: "asset-1", CreativeImageIDs: map[string]string{"8-sheet": "artwork-a", "Mega": "artwork-b"}}}}}}
	summary := &campaignSummary{Lines: []campaignLineResult{{ID: "asset-1", Market: "NSW", Breakdown: quantityBreakdown{"Mega": 1, "8-sheet": 40}}}}
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{
		"NSW": {
			"8-sheet":       testMaterialProductMapping("NSW Quad Product"),
			"asset:asset-1": testMaterialProductMapping("Asset Mega Product"),
		},
	}, map[string]string{
		"mega": "Legacy Mega Product",
	}, map[string]bool{"mega": true})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 2 {
		t.Fatalf("expected 2 products, got %d", len(products))
	}
	if products[0].ProductCode != "NSW Quad Product" || products[0].Quantity != 10 {
		t.Fatalf("unexpected non-custom product: %#v", products[0])
	}
	if products[1].ProductCode != "Asset Mega Product" || products[1].Quantity != 1 {
		t.Fatalf("unexpected custom product: %#v", products[1])
	}
}

func TestResolvePrintIQSheetProductsUsesSelectedAssetIDForCustomSheetSize(t *testing.T) {
	values := orderFormValues{CampaignMarkets: []campaignMarket{{Market: "Sydney", Assets: []campaignAsset{{ID: "campaign-row-1", AssetID: "Sydney-56", CreativeImageIDs: map[string]string{"Mega": "artwork-a"}}}}}}
	summary := &campaignSummary{Lines: []campaignLineResult{{ID: "campaign-row-1", Market: "Sydney", AssetLabel: "MEGASITE - Anzac Pde", Breakdown: quantityBreakdown{"Mega": 1}}}}
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{
		"Sydney": {
			"asset:Sydney-56|sheet:mega": testMaterialProductMapping("Mega Anzac Pde 8400x2900mm"),
		},
	}, map[string]string{}, map[string]bool{"mega": true})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 1 {
		t.Fatalf("expected 1 product, got %d", len(products))
	}
	if products[0].ProductCode != "Mega Anzac Pde 8400x2900mm" || products[0].Quantity != 1 {
		t.Fatalf("unexpected custom product: %#v", products[0])
	}
}

func TestResolvePrintIQSheetProductsFallsBackToLegacyAssetCodeForCustomSheetSize(t *testing.T) {
	values := orderFormValues{CampaignMarkets: []campaignMarket{{Market: "Sydney", Assets: []campaignAsset{{ID: "campaign-row-1", AssetID: "Sydney-56", CreativeImageIDs: map[string]string{"Mega": "artwork-a"}}}}}}
	summary := &campaignSummary{Lines: []campaignLineResult{{ID: "campaign-row-1", Market: "Sydney", AssetLabel: "MEGASITE - Anzac Pde", Breakdown: quantityBreakdown{"Mega": 1}}}}
	products, err := resolvePrintIQSheetProducts(values, summary, map[string]map[string]materialProductMapping{
		"Sydney": {
			"asset:Sydney-56": testMaterialProductMapping("Legacy Mega Anzac Pde"),
		},
	}, map[string]string{}, map[string]bool{"mega": true})
	if err != nil {
		t.Fatalf("resolve products: %v", err)
	}
	if len(products) != 1 || products[0].ProductCode != "Legacy Mega Anzac Pde" {
		t.Fatalf("unexpected custom product: %#v", products)
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

func TestResolvePrintIQArtworkURLUsesFirstPageForSinglePageSourcePDFWithoutMetadata(t *testing.T) {
	tempDir := t.TempDir()
	sourcePDF := gofpdf.New("P", "pt", "A4", "")
	sourcePDF.AddPage()
	sourcePDF.Text(20, 20, "single page")
	if err := sourcePDF.OutputFileAndClose(filepath.Join(tempDir, "source.pdf")); err != nil {
		t.Fatalf("create source pdf: %v", err)
	}

	pageImage := image.NewRGBA(image.Rect(0, 0, 20, 10))
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
		Name:                "CRTV-26903_SFL_Rev360_QLD_BRUNSWICK_MEGA_4200x2890_@25_HR",
		StoredName:          "page-1.png",
		SourcePDFStoredName: "source.pdf",
	})
	if err != nil {
		t.Fatalf("resolve artwork URL: %v", err)
	}
	if artworkURL != "https://app.example.com/api/campaign-images/source-page-0001-printiq.pdf/download" {
		t.Fatalf("expected first page PDF URL, got %s", artworkURL)
	}
}

func TestPrintIQAccountManagerSetForCreationAndAdditionalProducts(t *testing.T) {
	values := orderFormValues{ProductCode: "Quad", Quantity: "1"}
	product := printIQSheetProduct{ProductCode: "Quad", Quantity: 1}
	for _, payload := range []map[string]any{
		buildPrintIQCreateQuotePayload(values, nil, product, 0),
		buildPrintIQGetPricePayload(values, product, "Q123", "C00003"),
	} {
		if payload["AccountManagerID"] != "37112904-deff-4e5d-af0c-89f7c395a8a8" {
			t.Fatalf("wrong account manager: %#v", payload)
		}
	}
}

func TestBuildPrintIQGetPricePayload(t *testing.T) {
	payload := buildPrintIQGetPricePayload(
		orderFormValues{
			CampaignName:        "Asahi - GNBC Q3 - Campaign",
			ClientName:          "TestClient",
			PurchaseOrderNumber: "PO-1001",
			PrintImages: []campaignPrintImage{
				{ID: "artwork-a"},
				{ID: "artwork-b"},
			},
			CreativeNameAssignments: map[string]string{
				"Creative1": "artwork-a",
				"Creative2": "artwork-b",
			},
			ArtworkCodes: map[string]string{
				"artwork-b": "B200",
			},
		},
		printIQSheetProduct{ProductCode: "Double Product", SheetCode: "SHT-002", Quantity: 10, ArtworkImageID: "artwork-b"},
		"Q50206",
		"C00003",
	)
	if payload["ProductCode"] != "Double Product" || payload["QuoteNo"] != "Q50206" || payload["CustomerCode"] != "C00003" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
	if payload["JobTitle"] != "C2_TestClient_PO-1001_SHT-002-Double Product-Asahi - GNBC Q3 - Campaign" {
		t.Fatalf("unexpected job title: %#v", payload["JobTitle"])
	}
	quantity, ok := payload["SelectedQuantity"].(map[string]any)
	if !ok || quantity["Quantity"] != 10 || quantity["Kinds"] != 1 {
		t.Fatalf("unexpected quantity: %#v", payload["SelectedQuantity"])
	}
	if payload["AcceptQuote"] != false || payload["SimpleDetails"] != false {
		t.Fatalf("expected unaccepted quote with full details: %#v", payload)
	}
	if _, exists := payload["Deliveries"]; exists {
		t.Fatalf("expected no delivery override for blank address: %#v", payload)
	}
}

func TestBuildPrintIQGetPricePayloadSendsProductDelivery(t *testing.T) {
	payload := buildPrintIQGetPricePayload(
		orderFormValues{},
		printIQSheetProduct{
			ProductCode:     "Double Product",
			Quantity:        10,
			DeliveryAddress: "Melbourne Warehouse\n55 Collins St\nMelbourne VIC 3000\nPhone: 03 3333 3333\nDelivery time: 9am-1pm\nDelivery point: Loading dock\nNotes: Call on arrival\nAustralia",
		},
		"Q50206",
		"C00003",
	)
	for _, field := range []string{"Address", "DeliveryContact", "DeliveryNotes", "Quantities", "CopyDeliveryFromFirstProductToAllProducts"} {
		if _, exists := payload[field]; exists {
			t.Fatalf("unexpected delivery field %s: %#v", field, payload[field])
		}
	}
	deliveries, ok := payload["Deliveries"].([]map[string]any)
	if !ok || len(deliveries) != 1 || deliveries[0]["Quantity"] != 10 {
		t.Fatalf("unexpected deliveries: %#v", payload["Deliveries"])
	}
	delivery := deliveries[0]
	address := delivery["DestinationAddress"].(map[string]any)
	if address["Name"] != "Melbourne Warehouse" || address["AddressLine1"] != "55 Collins St" || address["City"] != "Melbourne" || address["State"] != "VIC" || address["PostCode"] != "3000" || address["Country"] != "Australia" {
		t.Fatalf("unexpected address: %#v", address)
	}
	contact := delivery["DestinationContact"].(map[string]any)
	if contact["FirstName"] != "Melbourne Warehouse" || contact["Phone"] != "03 3333 3333" || contact["Mobile"] != "03 3333 3333" {
		t.Fatalf("unexpected contact: %#v", contact)
	}
	if delivery["SpecialInstructions"] != "Delivery time: 9am-1pm | Delivery point: Loading dock | Call on arrival" {
		t.Fatalf("unexpected instructions: %#v", delivery)
	}
}

func TestBuildPrintIQCreateQuotePayloadUsesFormattedJobTitle(t *testing.T) {
	values := orderFormValues{
		CampaignName:        "Asahi - GNBC Q3 - Campaign",
		ClientName:          "TestClient",
		ProductCode:         "Syd A0 Quad 3364x1189",
		PurchaseOrderNumber: "PO-1001",
		Quantity:            "25",
		CreativeNameAssignments: map[string]string{
			"Creative1": "artwork-a",
		},
		ArtworkCodes: map[string]string{
			"artwork-a": "A100",
		},
	}
	payload := buildPrintIQCreateQuotePayload(
		values,
		nil,
		printIQSheetProduct{ProductCode: "Syd A0 Quad 3364x1189", SheetCode: "SHT-001", Quantity: 25, ArtworkImageID: "artwork-a"},
		123.456,
	)
	if payload["JobTitle"] != "C1_TestClient_PO-1001_SHT-001-Syd A0 Quad 3364x1189-Asahi - GNBC Q3 - Campaign" {
		t.Fatalf("unexpected job title: %#v", payload["JobTitle"])
	}
	if payload["TargetQuoteFreightPrice"] != 123.46 {
		t.Fatalf("unexpected TargetQuoteFreightPrice: %#v", payload["TargetQuoteFreightPrice"])
	}
}

func TestSummarizePrintIQPayloadIncludesTargetQuoteFreightPrice(t *testing.T) {
	summary := summarizePrintIQPayload("CreateQuoteWithDelivery", map[string]any{
		"ProductCode":             "Quad Product",
		"TargetQuoteFreightPrice": 265.75,
	})
	if summary["TargetQuoteFreightPrice"] != 265.75 {
		t.Fatalf("unexpected TargetQuoteFreightPrice summary: %#v", summary)
	}
}

func TestBuildPrintIQCreateQuotePayloadUsesProductDeliveryAddress(t *testing.T) {
	payload := buildPrintIQCreateQuotePayload(
		orderFormValues{ProductCode: "Quad Product", Quantity: "4"},
		nil,
		printIQSheetProduct{
			ProductCode:     "Quad Product",
			Quantity:        4,
			DeliveryAddress: "Brisbane Depot\n100 Queen St\nBrisbane QLD 4000\nPhone: 07 4444 4444\nDelivery point: Reception\nAustralia",
		},
		0,
	)
	address, ok := payload["Address"].(map[string]any)
	if !ok {
		t.Fatalf("expected Address payload, got %#v", payload["Address"])
	}
	if address["Name"] != "Brisbane Depot" || address["AddressLine1"] != "100 Queen St" || address["City"] != "Brisbane" || address["State"] != "QLD" || address["PostCode"] != "4000" {
		t.Fatalf("unexpected Address payload: %#v", address)
	}
	if payload["DeliveryNotes"] != "Delivery point: Reception" {
		t.Fatalf("unexpected DeliveryNotes payload: %#v", payload["DeliveryNotes"])
	}
}

func TestBuildPrintIQCreateQuotePayloadSendsDueDateAliases(t *testing.T) {
	values := orderFormValues{
		DueDate: "2026-09-02",
	}
	payload := buildPrintIQCreateQuotePayload(
		values,
		nil,
		printIQSheetProduct{ProductCode: "Quad Product", Quantity: 1},
		0,
	)
	if payload["CustomerExpectedDate"] != "2026-09-02" {
		t.Fatalf("unexpected CustomerExpectedDate: %#v", payload["CustomerExpectedDate"])
	}
	if payload["DueDate"] != "2026-09-02" {
		t.Fatalf("unexpected DueDate: %#v", payload["DueDate"])
	}
}

func TestBuildPrintIQAcceptQuotePayloadSendsDueDate(t *testing.T) {
	payload := buildPrintIQAcceptQuotePayload("Q50206", " 2026-09-02 ")
	if payload["QuoteNo"] != "Q50206" {
		t.Fatalf("unexpected QuoteNo: %#v", payload["QuoteNo"])
	}
	if payload["DueDate"] != "2026-09-02" {
		t.Fatalf("unexpected DueDate: %#v", payload["DueDate"])
	}

	payload = buildPrintIQAcceptQuotePayload("Q50206", " ")
	if _, ok := payload["DueDate"]; ok {
		t.Fatalf("did not expect empty DueDate in payload: %#v", payload)
	}
}

func TestExtractPurchaseOrderUploadBuildsAccessibleURL(t *testing.T) {
	t.Setenv("APP_BASE_URL", "https://app.example.com")
	tempDir := t.TempDir()
	storedName := "1700000000000-purchase-order.pdf"
	if err := os.WriteFile(filepath.Join(tempDir, storedName), []byte("%PDF-1.4"), 0o600); err != nil {
		t.Fatalf("write purchase order: %v", err)
	}

	upload, err := (&app{uploadDir: tempDir}).extractPurchaseOrderUpload(context.Background(), &purchaseOrderDetails{
		OriginalName: "Asahi PO.pdf",
		StoredName:   storedName,
		MimeType:     "application/pdf",
	})
	if err != nil {
		t.Fatalf("extract purchase order upload: %v", err)
	}
	if upload == nil {
		t.Fatal("expected purchase order upload")
	}
	if upload.ArtworkURL != "https://app.example.com/api/purchase-orders/1700000000000-purchase-order.pdf/download" {
		t.Fatalf("unexpected purchase order URL: %s", upload.ArtworkURL)
	}
	if upload.OverrideFileName != "Asahi PO" {
		t.Fatalf("unexpected override file name: %s", upload.OverrideFileName)
	}
}

func TestBuildPrintIQUploadArtworkPayloadUsesExplicitSupportingDocumentFlags(t *testing.T) {
	payload := buildPrintIQUploadArtworkPayload("J29328-01", printIQArtworkUpload{
		ArtworkURL:       "https://app.example.com/api/purchase-orders/po.pdf/download",
		OverrideFileName: "PO-1001",
	}, true, true)

	if payload["IsSupportingDocument"] != true {
		t.Fatalf("expected supporting document flag, got %#v", payload["IsSupportingDocument"])
	}
	if payload["IsLastArtworkFile"] != true {
		t.Fatalf("expected last artwork file flag, got %#v", payload["IsLastArtworkFile"])
	}
	if _, exists := payload["OverrideFileName"]; exists {
		t.Fatalf("did not expect OverrideFileName in UploadArtworkURL payload: %#v", payload)
	}
	if _, exists := payload["QSTKey"]; exists {
		t.Fatalf("did not expect QSTKey in UploadArtworkURL payload: %#v", payload)
	}
}

func TestSummarizePrintIQPayloadIncludesUploadArtworkURLPayload(t *testing.T) {
	payload := buildPrintIQUploadArtworkPayload("J29328-01", printIQArtworkUpload{
		ArtworkURL:       "https://adsartwork.syd1.cdn.digitaloceanspaces.com/test_artwork.pdf",
		OverrideFileName: "test_artwork",
	}, false, true)

	summary := summarizePrintIQPayload("UploadArtworkURL", payload)
	if summary["ArtworkUrl"] != "https://adsartwork.syd1.cdn.digitaloceanspaces.com/test_artwork.pdf" {
		t.Fatalf("expected artwork URL in summary, got %#v", summary["ArtworkUrl"])
	}
	if _, exists := summary["hasArtworkUrl"]; exists {
		t.Fatalf("did not expect hasArtworkUrl placeholder for UploadArtworkURL payload: %#v", summary)
	}
	if summary["IsSupportingDocument"] != false {
		t.Fatalf("expected supporting document flag, got %#v", summary["IsSupportingDocument"])
	}
	if summary["IsLastArtworkFile"] != true {
		t.Fatalf("expected last artwork file flag, got %#v", summary["IsLastArtworkFile"])
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

func TestExtractQQDKeyFindsProductQuantityKey(t *testing.T) {
	response := map[string]any{
		"QuoteDetails": map[string]any{
			"Products": []any{
				map[string]any{
					"Quantities": []any{
						map[string]any{
							"MiddlewareProductDetail": map[string]any{
								"QQDKey": float64(137262),
							},
						},
					},
				},
			},
		},
	}

	if key := printIQStringValue(extractQQDKey(response)); key != "137262" {
		t.Fatalf("expected QQDKey 137262, got %#v", key)
	}
}

func TestExtractQQDKeyForProductIndexUsesMatchingProduct(t *testing.T) {
	response := map[string]any{
		"QuoteDetails": map[string]any{
			"Products": []any{
				map[string]any{
					"Quantities": []any{
						map[string]any{"MiddlewareProductDetail": map[string]any{"QQDKey": float64(137263)}},
					},
				},
				map[string]any{
					"Quantities": []any{
						map[string]any{"MiddlewareProductDetail": map[string]any{"QQDKey": float64(137264)}},
					},
				},
				map[string]any{
					"Quantities": []any{
						map[string]any{"MiddlewareProductDetail": map[string]any{"QQDKey": float64(137265)}},
					},
				},
			},
		},
	}

	if key := printIQStringValue(extractQQDKeyForProductIndex(response, 1)); key != "137264" {
		t.Fatalf("expected second product QQDKey 137264, got %#v", key)
	}
	if key := printIQStringValue(extractQQDKey(response)); key != "137263" {
		t.Fatalf("expected generic extraction to keep first QQDKey behavior, got %#v", key)
	}
}

func TestExtractGetPriceQQDKeyMatchesCreatedProduct(t *testing.T) {
	response := map[string]any{
		"ProductKey": float64(22),
		"QuoteDetails": map[string]any{"Products": []any{
			map[string]any{"ProductKey": float64(22), "Quantities": []any{map[string]any{"MiddlewareProductDetail": map[string]any{"QQDKey": float64(222)}}}},
			map[string]any{"ProductKey": float64(11), "Quantities": []any{map[string]any{"MiddlewareProductDetail": map[string]any{"QQDKey": float64(111)}}}},
		}},
	}
	if key := printIQStringValue(extractGetPriceQQDKey(response)); key != "222" {
		t.Fatalf("expected created product quantity, got %q", key)
	}
	for _, key := range []any{nil, float64(0), float64(33)} {
		response["ProductKey"] = key
		if got := extractGetPriceQQDKey(response); got != nil {
			t.Fatalf("must not select another product for key %v: %v", key, got)
		}
	}
}

func TestExtractQQDPKeyFindsQuestionProductKey(t *testing.T) {
	response := map[string]any{
		"QuoteQuestionSections": []any{},
		"Product": map[string]any{
			"QQDPKey": float64(105717),
			"QQDKey":  float64(0),
		},
	}

	if key := printIQStringValue(extractQQDPKey(response)); key != "105717" {
		t.Fatalf("expected QQDPKey 105717, got %#v", key)
	}
}

func TestBuildPrintIQSaveProofContactQuestionsPayloadUsesADSPrepressContact(t *testing.T) {
	payload := buildPrintIQSaveProofContactQuestionsPayload([]any{float64(105717), float64(105718)})
	answers, ok := payload["Answers"].([]map[string]any)
	if !ok {
		t.Fatalf("expected Answers payload, got %#v", payload["Answers"])
	}
	if len(answers) != 2 {
		t.Fatalf("expected 2 answers, got %d", len(answers))
	}
	for index, answer := range answers {
		if answer["QQQAValue"] != "15205|ADS Prepress|CONTACT" {
			t.Fatalf("answer %d used unexpected proof contact: %#v", index, answer["QQQAValue"])
		}
		if answer["QSTKey"] != 0 || answer["QSideKey"] != 0 || answer["QQDSKey"] != 0 || answer["QQADKey"] != 0 {
			t.Fatalf("answer %d used unexpected zero-key fields: %#v", index, answer)
		}
		if answer["QQQxKey"] != 5 || answer["QQQLITKey"] != 6 || answer["QQQLIKey"] != 4 {
			t.Fatalf("answer %d used unexpected question identifiers: %#v", index, answer)
		}
	}
}
