package main

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

type parsedDeliveryAddress struct {
	Name         string
	AddressLine1 string
	City         string
	State        string
	PostCode     string
	Country      string
	Phone        string
	Notes        string
}

type printIQArtworkUpload struct {
	ArtworkURL       string
	OverrideFileName string
}

type printIQSheetProduct struct {
	Market         string
	FormatKey      string
	ProductCode    string
	SheetCode      string
	Quantity       int
	ArtworkImageID string
}

type printIQSheetProductMergeKey struct {
	Market         string
	FormatKey      string
	ProductCode    string
	SheetCode      string
	ArtworkImageID string
}

type printIQSheetFormat struct {
	breakdownKey string
	settingsKey  string
}

var creativeNamePattern = regexp.MustCompile(`(?i)^Creative(\d+)$`)

func resolveCreativeNumber(values orderFormValues, artworkImageID string) int {
	trimmedArtworkImageID := strings.TrimSpace(artworkImageID)
	if trimmedArtworkImageID != "" {
		for creativeName, imageID := range values.CreativeNameAssignments {
			if strings.TrimSpace(imageID) != trimmedArtworkImageID {
				continue
			}
			match := creativeNamePattern.FindStringSubmatch(strings.TrimSpace(creativeName))
			if len(match) == 2 {
				if number, err := strconv.Atoi(match[1]); err == nil && number > 0 {
					return number
				}
			}
		}
		for index, image := range values.PrintImages {
			if strings.TrimSpace(image.ID) == trimmedArtworkImageID {
				return index + 1
			}
		}
	}
	return 1
}

func buildPrintIQJobTitle(values orderFormValues, product printIQSheetProduct) string {
	creativeNumber := resolveCreativeNumber(values, product.ArtworkImageID)
	productCode := strings.TrimSpace(product.ProductCode)
	campaignName := strings.TrimSpace(values.CampaignName)
	clientName := strings.TrimSpace(values.ClientName)
	sheetCode := strings.TrimSpace(product.SheetCode)
	purchaseOrderNumber := strings.TrimSpace(values.PurchaseOrderNumber)
	if productCode == "" {
		productCode = strings.TrimSpace(values.ProductCode)
	}
	titleParts := []string{fmt.Sprintf("C%d", creativeNumber)}
	if clientName != "" {
		titleParts = append(titleParts, clientName)
	}
	if purchaseOrderNumber != "" {
		titleParts = append(titleParts, purchaseOrderNumber)
	}
	productParts := make([]string, 0, 3)
	if sheetCode != "" {
		productParts = append(productParts, sheetCode)
	}
	if productCode != "" {
		productParts = append(productParts, productCode)
	}
	if campaignName != "" {
		productParts = append(productParts, campaignName)
	}
	if len(productParts) > 0 {
		titleParts = append(titleParts, strings.Join(productParts, "-"))
	}
	return strings.Join(titleParts, "_")
}

var printIQSheetFormatOrder = []printIQSheetFormat{
	{"8-sheet", "8-sheet"},
	{"QA0", "8-sheet-a0"},
	{"6-sheet", "6-sheet"},
	{"4-sheet", "4-sheet"},
	{"2-sheet", "2-sheet"},
	{"Mega", "mega"},
	{"DOT M", "dot-m"},
	{"MP", "mega-portrait"},
	{"FF", "ff"},
}

func canonicalPrintIQSheetKey(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(normalized, " ")
	normalized = strings.TrimSpace(normalized)
	if normalized == "" {
		return ""
	}
	switch normalized {
	case "8 sheet", "8sheet":
		return "8-sheet"
	case "8 sheet a0", "8sheet a0", "a0 8 sheet", "qa0", "qao", "8 sheet qa0", "a0 sized 8 sheet", "a0 sized 4 sheet":
		return "8-sheet-a0"
	case "6 sheet", "6sheet":
		return "6-sheet"
	case "4 sheet", "4sheet":
		return "4-sheet"
	case "2 sheet", "2sheet":
		return "2-sheet"
	case "mega":
		return "mega"
	case "dot m", "dotm", "dot mega", "dot megasite":
		return "dot-m"
	case "mega portrait", "mp":
		return "mega-portrait"
	case "ff", "ferro film", "ferrofilm":
		return "ff"
	default:
		return strings.ReplaceAll(normalized, " ", "-")
	}
}

func printIQSheetFormatsForSummary(summary *campaignSummary) []printIQSheetFormat {
	formats := append([]printIQSheetFormat{}, printIQSheetFormatOrder...)
	seen := map[string]bool{}
	for _, format := range formats {
		seen[format.breakdownKey] = true
	}
	for _, line := range summary.Lines {
		for key, quantity := range line.Breakdown {
			trimmedKey := strings.TrimSpace(key)
			if trimmedKey == "" || quantity <= 0 || seen[trimmedKey] {
				continue
			}
			settingsKey := canonicalPrintIQSheetKey(trimmedKey)
			if settingsKey == "" {
				continue
			}
			formats = append(formats, printIQSheetFormat{breakdownKey: trimmedKey, settingsKey: settingsKey})
			seen[trimmedKey] = true
		}
	}
	return formats
}

func isBuiltInPrintIQSheetFormat(key string) bool {
	for _, format := range printIQSheetFormatOrder {
		if format.breakdownKey == key {
			return true
		}
	}
	return false
}

func missingPrintIQProductCodeError(market string, formatKey string, assetLabel string, assetID string, customSheetSize bool) error {
	market = strings.TrimSpace(market)
	formatKey = strings.TrimSpace(formatKey)
	assetLabel = strings.TrimSpace(assetLabel)
	assetID = strings.TrimSpace(assetID)
	details := []string{}
	if market != "" {
		details = append(details, "market "+market)
	}
	if formatKey != "" {
		details = append(details, "format "+formatKey)
	}
	if customSheetSize {
		if assetLabel != "" {
			details = append(details, "asset "+assetLabel)
		} else if assetID != "" {
			details = append(details, "asset "+assetID)
		}
	}
	if len(details) == 0 {
		return errors.New("Product code configured is not correct. Contact Support")
	}
	return fmt.Errorf("Product code configured is not correct for %s. Contact Support", strings.Join(details, ", "))
}

func assetProductCodeKey(assetID string) string {
	return "asset:" + strings.TrimSpace(assetID)
}

func assetSheetProductCodeKey(assetID string, sheetKey string) string {
	return assetProductCodeKey(assetID) + "|sheet:" + strings.TrimSpace(sheetKey)
}

func resolveCustomPrintIQProductMapping(marketProductMappings map[string]materialProductMapping, summaryLine campaignLineResult, asset campaignAsset, sheetKey string) materialProductMapping {
	for _, assetID := range []string{summaryLine.ID, asset.AssetID} {
		trimmedAssetID := strings.TrimSpace(assetID)
		if trimmedAssetID == "" {
			continue
		}
		if mapping := marketProductMappings[assetSheetProductCodeKey(trimmedAssetID, sheetKey)]; strings.TrimSpace(mapping.ProductCode) != "" {
			return mapping
		}
	}
	for _, assetID := range []string{summaryLine.ID, asset.AssetID} {
		trimmedAssetID := strings.TrimSpace(assetID)
		if trimmedAssetID == "" {
			continue
		}
		if mapping := marketProductMappings[assetProductCodeKey(trimmedAssetID)]; strings.TrimSpace(mapping.ProductCode) != "" {
			return mapping
		}
	}
	return materialProductMapping{}
}

func printIQFrameQuantity(formatKey string, posterQuantity int) int {
	if posterQuantity <= 0 {
		return 0
	}
	switch formatKey {
	case "8-sheet", "QA0":
		return (posterQuantity + 3) / 4
	case "6-sheet":
		return (posterQuantity + 2) / 3
	case "4-sheet":
		return (posterQuantity + 1) / 2
	default:
		return posterQuantity
	}
}

func appendPrintIQSheetProduct(products []printIQSheetProduct, indexes map[printIQSheetProductMergeKey]int, product printIQSheetProduct) ([]printIQSheetProduct, int) {
	key := printIQSheetProductMergeKey{
		Market:         strings.TrimSpace(product.Market),
		FormatKey:      strings.TrimSpace(product.FormatKey),
		ProductCode:    strings.TrimSpace(product.ProductCode),
		SheetCode:      strings.TrimSpace(product.SheetCode),
		ArtworkImageID: strings.TrimSpace(product.ArtworkImageID),
	}
	if index, exists := indexes[key]; exists {
		products[index].Quantity += product.Quantity
		return products, index
	}
	indexes[key] = len(products)
	return append(products, product), indexes[key]
}

func resolvePrintIQSheetProducts(values orderFormValues, summary *campaignSummary, productMappingsByMarket map[string]map[string]materialProductMapping, fallbackProductCodes map[string]string, customSheetSizeFormats map[string]bool) ([]printIQSheetProduct, error) {
	if summary == nil {
		return nil, errors.New("Campaign calculation summary is required")
	}
	assets := map[string]campaignAsset{}
	for _, market := range values.CampaignMarkets {
		for _, asset := range market.Assets {
			assets[asset.ID] = asset
		}
	}
	products := make([]printIQSheetProduct, 0)
	productIndexes := map[printIQSheetProductMergeKey]int{}
	for _, format := range printIQSheetFormatsForSummary(summary) {
		for _, summaryLine := range summary.Lines {
			posterQuantity := summaryLine.Breakdown[format.breakdownKey]
			if posterQuantity <= 0 {
				continue
			}
			market := strings.TrimSpace(summaryLine.Market)
			printIQQuantity := printIQFrameQuantity(format.breakdownKey, posterQuantity)
			marketProductMappings := productMappingsByMarket[market]
			asset := assets[summaryLine.ID]
			productCodeKey := format.settingsKey
			useCustomSheetSize := customSheetSizeFormats[format.settingsKey] || !isBuiltInPrintIQSheetFormat(format.breakdownKey)
			productMapping := marketProductMappings[productCodeKey]
			productCode := strings.TrimSpace(productMapping.ProductCode)
			sheetCode := strings.TrimSpace(productMapping.SheetCode)
			if useCustomSheetSize {
				productMapping = resolveCustomPrintIQProductMapping(marketProductMappings, summaryLine, asset, format.settingsKey)
				productCode = strings.TrimSpace(productMapping.ProductCode)
				sheetCode = strings.TrimSpace(productMapping.SheetCode)
				if productCode == "" {
					productCodeKey = assetSheetProductCodeKey(summaryLine.ID, format.settingsKey)
				}
			}
			if productCode == "" && !useCustomSheetSize {
				productCode = strings.TrimSpace(fallbackProductCodes[productCodeKey])
			}
			if productCode == "" && useCustomSheetSize {
				fallbackMapping := marketProductMappings[assetProductCodeKey(summaryLine.ID)]
				productCode = strings.TrimSpace(fallbackMapping.ProductCode)
				sheetCode = strings.TrimSpace(fallbackMapping.SheetCode)
			}
			if productCode == "" {
				return nil, missingPrintIQProductCodeError(market, format.breakdownKey, summaryLine.AssetLabel, summaryLine.ID, useCustomSheetSize)
			}
			assignments := asset.ArtworkMaterialAssignments[format.breakdownKey]
			if len(assignments) == 0 {
				artworkImageID := asset.CreativeImageIDs[format.breakdownKey]
				if artworkImageID == "" && format.breakdownKey == "8-sheet" {
					artworkImageID = asset.CreativeImageID
				}
				if strings.TrimSpace(artworkImageID) == "" {
					continue
				}
				products, _ = appendPrintIQSheetProduct(products, productIndexes, printIQSheetProduct{Market: market, FormatKey: format.breakdownKey, ProductCode: productCode, SheetCode: sheetCode, Quantity: printIQQuantity, ArtworkImageID: artworkImageID})
				continue
			}

			remaining := printIQQuantity
			lastAssignedProductIndex := -1
			for _, assignment := range assignments {
				if assignment.FrameCount <= 0 || remaining <= 0 {
					continue
				}
				if strings.TrimSpace(assignment.ArtworkImageID) == "" {
					continue
				}
				assignedQuantity := assignment.FrameCount
				if assignedQuantity > remaining {
					assignedQuantity = remaining
				}
				var productIndex int
				products, productIndex = appendPrintIQSheetProduct(products, productIndexes, printIQSheetProduct{Market: market, FormatKey: format.breakdownKey, ProductCode: productCode, SheetCode: sheetCode, Quantity: assignedQuantity, ArtworkImageID: assignment.ArtworkImageID})
				lastAssignedProductIndex = productIndex
				remaining -= assignedQuantity
			}
			if remaining > 0 && lastAssignedProductIndex >= 0 {
				products[lastAssignedProductIndex].Quantity += remaining
			}
		}
	}
	if len(products) == 0 {
		return nil, errors.New("Campaign has no sheet quantities to submit")
	}
	sort.SliceStable(products, func(i, j int) bool {
		return resolveCreativeNumber(values, products[i].ArtworkImageID) < resolveCreativeNumber(values, products[j].ArtworkImageID)
	})
	return products, nil
}

func buildPrintIQGetPriceForProductPayload(values orderFormValues, product printIQSheetProduct, quoteNo, customerCode string) map[string]any {
	return map[string]any{
		"ProductCode": product.ProductCode,
		"Quantities": []map[string]any{{
			"Quantity": product.Quantity,
			"Kinds":    1,
		}},
		"QuoteNo":          quoteNo,
		"JobTitle":         buildPrintIQJobTitle(values, product),
		"CustomerCode":     customerCode,
		"AccountManagerID": "00000000-0000-0000-0000-000000000000",
		"CopyDeliveryFromFirstProductToAllProducts": true,
	}
}

const printIQProofContactAnswer = "15205|ADS Prepress|CONTACT"

func buildPrintIQGetQuoteQuestionsPayload(qqdKey any) map[string]any {
	return map[string]any{
		"QQDKey": qqdKey,
	}
}

func buildPrintIQSaveProofContactQuestionsPayload(qqdpKeys []any) map[string]any {
	answers := make([]map[string]any, 0, len(qqdpKeys))
	for _, qqdpKey := range qqdpKeys {
		answers = append(answers, map[string]any{
			"QQDPKey":   qqdpKey,
			"QQQAValue": printIQProofContactAnswer,
			"QSTKey":    0,
			"QSideKey":  0,
			"QQDSKey":   0,
			"QQADKey":   0,
			"QQQxKey":   5,
			"QQQLITKey": 6,
			"QQQLIKey":  4,
		})
	}
	return map[string]any{"Answers": answers}
}

func buildPrintIQAcceptQuotePayload(quoteNo, dueDate string) map[string]any {
	payload := map[string]any{"QuoteNo": quoteNo}
	setStringIfPresent(payload, "DueDate", dueDate)
	return payload
}

func resolveQuantity(values orderFormValues, summary *campaignSummary) int {
	explicitQuantity, err := strconv.Atoi(strings.TrimSpace(values.Quantity))
	if err == nil && explicitQuantity > 0 {
		return explicitQuantity
	}
	if summary != nil {
		return summary.GrandTotal.TotalUnits
	}
	return 0
}

func firstCampaignDeliveryAddress(values orderFormValues) string {
	for _, market := range values.CampaignMarkets {
		for _, asset := range market.Assets {
			if trimmed := strings.TrimSpace(asset.DeliveryAddress); trimmed != "" {
				return trimmed
			}
		}
	}
	return ""
}

func parseCampaignDeliveryAddress(rawAddress string) parsedDeliveryAddress {
	lines := strings.Split(rawAddress, "\n")
	cleanLines := make([]string, 0, len(lines))
	for _, line := range lines {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			cleanLines = append(cleanLines, trimmed)
		}
	}

	address := parsedDeliveryAddress{}
	if len(cleanLines) > 0 {
		address.Name = cleanLines[0]
	}
	if len(cleanLines) > 1 {
		address.AddressLine1 = cleanLines[1]
	}
	if len(cleanLines) > 2 {
		locality := strings.Fields(cleanLines[2])
		if len(locality) >= 3 {
			address.PostCode = locality[len(locality)-1]
			address.State = locality[len(locality)-2]
			address.City = strings.Join(locality[:len(locality)-2], " ")
		} else {
			address.City = cleanLines[2]
		}
	}
	if len(cleanLines) > 0 {
		lastLine := cleanLines[len(cleanLines)-1]
		if !strings.Contains(lastLine, ":") && lastLine != address.AddressLine1 && lastLine != address.City {
			address.Country = lastLine
		}
	}
	for _, line := range cleanLines {
		lower := strings.ToLower(line)
		switch {
		case strings.HasPrefix(lower, "phone:"):
			address.Phone = strings.TrimSpace(line[len("phone:"):])
		case strings.HasPrefix(lower, "notes:"):
			address.Notes = strings.TrimSpace(line[len("notes:"):])
		}
	}
	return address
}

func setStringIfPresent(target map[string]any, key, value string) {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		target[key] = trimmed
	}
}

func setAnyIfPresent(target map[string]any, key string, value any) {
	if value != nil {
		target[key] = value
	}
}

func stringMapHasValues(value map[string]any) bool {
	for _, entry := range value {
		switch typed := entry.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return true
			}
		case nil:
		default:
			return true
		}
	}
	return false
}

func buildPrintIQCreateQuotePayload(values orderFormValues, summary *campaignSummary, product printIQSheetProduct) map[string]any {
	quantity := resolveQuantity(values, summary)
	deliveryAddress := parseCampaignDeliveryAddress(firstCampaignDeliveryAddress(values))

	payload := map[string]any{
		"Accept":              "false",
		"QuoteFiles":          nil,
		"FilterInput":         nil,
		"ValidUntill":         nil,
		"FilterProductToken":  "",
		"AllArtworkSubmitted": "false",
	}
	setStringIfPresent(payload, "Notes", values.Notes)
	setStringIfPresent(payload, "JobTitle", buildPrintIQJobTitle(values, product))
	setStringIfPresent(payload, "ProductCode", values.ProductCode)
	setStringIfPresent(payload, "CustomerCode", values.CustomerCode)
	setStringIfPresent(payload, "CustomerReference", values.CustomerReference)
	setStringIfPresent(payload, "SpecialInstructions", values.JobDescription)
	setStringIfPresent(payload, "CustomerExpectedDate", values.DueDate)
	setStringIfPresent(payload, "DueDate", values.DueDate)
	setStringIfPresent(payload, "ExternalJobReference", firstNonEmpty(values.KindName, values.CustomerReference))

	if quantity > 0 {
		payload["Quantity"] = map[string]any{
			"Kinds":    "1",
			"Quantity": strconv.Itoa(quantity),
		}
	}

	address := map[string]any{}
	setStringIfPresent(address, "Name", deliveryAddress.Name)
	setStringIfPresent(address, "AddressLine1", deliveryAddress.AddressLine1)
	setStringIfPresent(address, "City", deliveryAddress.City)
	setStringIfPresent(address, "State", deliveryAddress.State)
	setStringIfPresent(address, "PostCode", deliveryAddress.PostCode)
	setStringIfPresent(address, "Country", deliveryAddress.Country)
	if stringMapHasValues(address) {
		payload["Address"] = address
	}

	quoteContact := map[string]any{}
	setStringIfPresent(quoteContact, "FirstName", values.Contact.FirstName)
	setStringIfPresent(quoteContact, "Surname", values.Contact.Surname)
	setStringIfPresent(quoteContact, "Email", values.Contact.Email)
	if stringMapHasValues(quoteContact) {
		quoteContact["IsAddressSpecific"] = "true"
		payload["QuoteContact"] = quoteContact
	}

	deliveryContact := map[string]any{}
	setStringIfPresent(deliveryContact, "FirstName", deliveryAddress.Name)
	setStringIfPresent(deliveryContact, "Phone", deliveryAddress.Phone)
	setStringIfPresent(deliveryContact, "Mobile", deliveryAddress.Phone)
	if stringMapHasValues(deliveryContact) {
		deliveryContact["IsAddressSpecific"] = "true"
		payload["DeliveryContact"] = deliveryContact
	}
	setStringIfPresent(payload, "DeliveryNotes", deliveryAddress.Notes)

	return payload
}

func (a *app) extractCampaignArtworkUpload(ctx context.Context, values orderFormValues, imageID string) (*printIQArtworkUpload, error) {
	trimmedImageID := strings.TrimSpace(imageID)
	if trimmedImageID == "" {
		return nil, nil
	}
	for _, image := range values.PrintImages {
		if image.ID != trimmedImageID {
			continue
		}
		artworkURL, err := a.resolvePrintIQArtworkURL(ctx, image)
		if err != nil {
			return nil, err
		}
		if artworkURL == "" {
			return nil, nil
		}
		overrideFileName := strings.TrimSpace(image.Name)
		if overrideFileName == "" {
			overrideFileName = strings.TrimSpace(image.FileName)
		}
		if ext := filepath.Ext(overrideFileName); ext != "" {
			overrideFileName = strings.TrimSuffix(overrideFileName, ext)
		}
		return &printIQArtworkUpload{ArtworkURL: artworkURL, OverrideFileName: overrideFileName}, nil
	}
	return nil, fmt.Errorf("Assigned artwork %s was not found", trimmedImageID)
}

func (a *app) extractPurchaseOrderUpload(ctx context.Context, purchaseOrder *purchaseOrderDetails) (*printIQArtworkUpload, error) {
	if purchaseOrder == nil {
		return nil, nil
	}
	storedName := strings.TrimSpace(purchaseOrder.StoredName)
	if storedName == "" {
		return nil, nil
	}
	if !isSafeStoredName(storedName) {
		return nil, fmt.Errorf("Purchase order file %s is not safe to submit to PrintIQ", storedName)
	}
	info, err := os.Stat(filepath.Join(a.uploadDir, storedName))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, errors.New("Purchase order file not found")
		}
		return nil, err
	}

	purchaseOrderURL, err := a.resolvePurchaseOrderArtworkURL(ctx, storedName, purchaseOrder.MimeType, info.Size())
	if err != nil {
		return nil, err
	}

	overrideFileName := strings.TrimSpace(purchaseOrder.OriginalName)
	if ext := filepath.Ext(overrideFileName); ext != "" {
		overrideFileName = strings.TrimSuffix(overrideFileName, ext)
	}
	if overrideFileName == "" {
		overrideFileName = "Purchase Order"
	}
	return &printIQArtworkUpload{ArtworkURL: purchaseOrderURL, OverrideFileName: overrideFileName}, nil
}

func (a *app) resolvePurchaseOrderArtworkURL(ctx context.Context, storedName, contentType string, size int64) (string, error) {
	if a.objectStorage != nil {
		source, err := os.Open(filepath.Join(a.uploadDir, storedName))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return "", errors.New("Purchase order file not found")
			}
			return "", err
		}
		defer source.Close()

		uploadContentType := strings.TrimSpace(contentType)
		if uploadContentType == "" {
			uploadContentType = mime.TypeByExtension(strings.ToLower(filepath.Ext(storedName)))
		}
		if uploadContentType == "" {
			uploadContentType = "application/octet-stream"
		}
		if err := a.storeCampaignImageReader(ctx, storedName, uploadContentType, source, size); err != nil {
			return "", fmt.Errorf("upload purchase order to DigitalOcean Spaces: %w", err)
		}
		if publicURL, ok, err := a.campaignImagePublicURL(ctx, storedName); err != nil {
			return "", err
		} else if ok {
			return publicURL, nil
		}
	}

	purchaseOrderURL := "/api/purchase-orders/" + url.PathEscape(storedName) + "/download"
	appBaseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("APP_BASE_URL")), "/")
	if appBaseURL != "" {
		purchaseOrderURL = appBaseURL + "/" + strings.TrimLeft(purchaseOrderURL, "/")
	}
	return purchaseOrderURL, nil
}

func (a *app) resolvePrintIQArtworkURL(ctx context.Context, image campaignPrintImage) (string, error) {
	storedName := strings.TrimSpace(firstNonEmpty(image.StoredName, image.SourcePDFStoredName))
	generatedArtworkPDF := false
	if strings.TrimSpace(image.StoredName) != "" && !isPDFStoredName(image.StoredName) {
		pdfStoredName, err := a.ensurePrintIQArtworkPDF(ctx, image)
		if err != nil {
			return "", err
		}
		if publicURL, ok, err := a.campaignImagePublicURL(ctx, pdfStoredName); err != nil {
			return "", err
		} else if ok {
			return publicURL, nil
		}
		storedName = pdfStoredName
		generatedArtworkPDF = true
	}
	if publicURL, ok, err := a.campaignImagePublicURL(ctx, storedName); err != nil {
		return "", err
	} else if ok {
		return publicURL, nil
	}

	artworkURL := strings.TrimSpace(firstNonEmpty(image.ImageURL, image.SourcePDFURL))
	if generatedArtworkPDF {
		artworkURL = ""
	}
	if artworkURL == "" && storedName != "" {
		artworkURL = "/api/campaign-images/" + url.PathEscape(storedName) + "/download"
	}
	if artworkURL == "" {
		return "", nil
	}
	if parsed, err := url.Parse(artworkURL); err == nil && parsed.IsAbs() {
		return artworkURL, nil
	}

	appBaseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("APP_BASE_URL")), "/")
	if appBaseURL == "" {
		return artworkURL, nil
	}
	return appBaseURL + "/" + strings.TrimLeft(artworkURL, "/"), nil
}

func isPDFStoredName(storedName string) bool {
	return strings.EqualFold(filepath.Ext(strings.TrimSpace(storedName)), ".pdf")
}

func printIQSourcePagePDFStoredName(sourcePDFStoredName string, pageNumber int) string {
	extension := filepath.Ext(sourcePDFStoredName)
	baseName := strings.TrimSuffix(sourcePDFStoredName, extension)
	return fmt.Sprintf("%s-page-%04d-printiq.pdf", baseName, pageNumber)
}

var artworkPageNamePattern = regexp.MustCompile(`(?i)\(\s*page\s+(\d+)\s*\)`)

func resolveArtworkSourcePageNumber(image campaignPrintImage) int {
	if image.SourcePDFPageNumber > 0 {
		return image.SourcePDFPageNumber
	}
	if image.SourcePDFPageCount == 1 {
		return 1
	}
	matches := artworkPageNamePattern.FindStringSubmatch(image.Name)
	if len(matches) < 2 {
		return 0
	}
	pageNumber, err := strconv.Atoi(matches[1])
	if err != nil || pageNumber <= 0 {
		return 0
	}
	return pageNumber
}

func (a *app) ensurePrintIQArtworkPDF(ctx context.Context, image campaignPrintImage) (string, error) {
	sourcePDFStoredName := strings.TrimSpace(image.SourcePDFStoredName)
	if sourcePDFStoredName == "" {
		return "", errors.New("Source PDF is required to submit artwork to PrintIQ")
	}
	pageNumber := resolveArtworkSourcePageNumber(image)

	tempDir, err := os.MkdirTemp("", "flowiq-printiq-artwork-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tempDir)

	sourcePDFPath := filepath.Join(tempDir, "source.pdf")
	if err := a.copyCampaignImageToFile(ctx, sourcePDFStoredName, sourcePDFPath); err != nil {
		return "", err
	}

	if pageNumber <= 0 {
		pageCount, err := api.PageCountFile(sourcePDFPath)
		if err != nil {
			return "", err
		}
		if pageCount == 1 {
			pageNumber = 1
		}
	}
	if pageNumber <= 0 {
		return "", fmt.Errorf("Source PDF page number is required for artwork %s", strings.TrimSpace(image.Name))
	}
	pdfStoredName := printIQSourcePagePDFStoredName(sourcePDFStoredName, pageNumber)
	if exists, err := a.campaignImageExists(ctx, pdfStoredName); err != nil {
		return "", err
	} else if exists {
		return pdfStoredName, nil
	}

	pdfPath, err := extractSinglePDFPageFile(ctx, sourcePDFPath, tempDir, pageNumber)
	if err != nil {
		return "", err
	}
	pdfFile, err := os.Open(pdfPath)
	if err != nil {
		return "", err
	}
	defer pdfFile.Close()
	pdfInfo, err := pdfFile.Stat()
	if err != nil {
		return "", err
	}
	if err := a.storeCampaignImageReader(ctx, pdfStoredName, "application/pdf", pdfFile, pdfInfo.Size()); err != nil {
		return "", err
	}
	return pdfStoredName, nil
}

func extractSinglePDFPageFile(ctx context.Context, sourcePDFPath, outputDir string, pageNumber int) (string, error) {
	if pageNumber <= 0 {
		return "", errors.New("PDF page number must be greater than 0")
	}
	if pdfSeparatePath, err := exec.LookPath("pdfseparate"); err == nil {
		outputPath := filepath.Join(outputDir, fmt.Sprintf("source-page-%d.pdf", pageNumber))
		extractCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(
			extractCtx,
			pdfSeparatePath,
			"-f", strconv.Itoa(pageNumber),
			"-l", strconv.Itoa(pageNumber),
			sourcePDFPath,
			outputPath,
		)
		if output, err := cmd.CombinedOutput(); err != nil {
			if extractCtx.Err() != nil {
				return "", fmt.Errorf("extract PDF page %d timed out", pageNumber)
			}
			return "", fmt.Errorf("extract PDF page %d with pdfseparate: %w: %s", pageNumber, err, strings.TrimSpace(string(output)))
		}
		if info, err := os.Stat(outputPath); err != nil {
			return "", err
		} else if info.Size() == 0 {
			return "", fmt.Errorf("PDF page %d could not be extracted", pageNumber)
		}
		return outputPath, nil
	}

	if err := api.ExtractPagesFile(sourcePDFPath, outputDir, []string{strconv.Itoa(pageNumber)}, model.NewDefaultConfiguration()); err != nil {
		return "", err
	}
	outputPath := filepath.Join(outputDir, fmt.Sprintf("%s_page_%d.pdf", strings.TrimSuffix(filepath.Base(sourcePDFPath), ".pdf"), pageNumber))
	if info, err := os.Stat(outputPath); err != nil {
		return "", err
	} else if info.Size() == 0 {
		return "", fmt.Errorf("PDF page %d could not be extracted", pageNumber)
	}
	return outputPath, nil
}

func buildPrintIQUploadArtworkPayload(jobNo string, artwork printIQArtworkUpload, isSupportingDocument, isLastArtworkFile bool) map[string]any {
	return map[string]any{
		"JobNo":                jobNo,
		"ArtworkUrl":           artwork.ArtworkURL,
		"IsSupportingDocument": isSupportingDocument,
		"IsLastArtworkFile":    isLastArtworkFile,
	}
}

func ternaryStringToAny(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
