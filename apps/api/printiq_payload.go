package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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
	FormatKey      string
	ProductCode    string
	SheetCode      string
	Quantity       int
	ArtworkImageID string
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
	sheetCode := strings.TrimSpace(product.SheetCode)
	purchaseOrderNumber := strings.TrimSpace(values.PurchaseOrderNumber)
	if productCode == "" {
		productCode = strings.TrimSpace(values.ProductCode)
	}
	jobTitle := fmt.Sprintf("C%d / %s", creativeNumber, productCode)
	if campaignName == "" {
		if sheetCode != "" {
			jobTitle = fmt.Sprintf("%s - %s", jobTitle, sheetCode)
		}
		if purchaseOrderNumber != "" {
			jobTitle = fmt.Sprintf("%s - %s", jobTitle, purchaseOrderNumber)
		}
		return jobTitle
	}
	jobTitle = fmt.Sprintf("%s ( %s)", jobTitle, campaignName)
	if sheetCode != "" {
		jobTitle = fmt.Sprintf("%s - %s", jobTitle, sheetCode)
	}
	if purchaseOrderNumber != "" {
		jobTitle = fmt.Sprintf("%s - %s", jobTitle, purchaseOrderNumber)
	}
	return jobTitle
}

var printIQSheetFormatOrder = []struct {
	breakdownKey string
	settingsKey  string
}{
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

func assetProductCodeKey(assetID string) string {
	return "asset:" + strings.TrimSpace(assetID)
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
	for _, format := range printIQSheetFormatOrder {
		for _, summaryLine := range summary.Lines {
			posterQuantity := summaryLine.Breakdown[format.breakdownKey]
			if posterQuantity <= 0 {
				continue
			}
			printIQQuantity := printIQFrameQuantity(format.breakdownKey, posterQuantity)
			marketProductMappings := productMappingsByMarket[strings.TrimSpace(summaryLine.Market)]
			productCodeKey := format.settingsKey
			useCustomSheetSize := customSheetSizeFormats[format.settingsKey]
			if useCustomSheetSize {
				productCodeKey = assetProductCodeKey(summaryLine.ID)
			}
			productMapping := marketProductMappings[productCodeKey]
			productCode := strings.TrimSpace(productMapping.ProductCode)
			sheetCode := strings.TrimSpace(productMapping.SheetCode)
			if productCode == "" && !useCustomSheetSize {
				productCode = strings.TrimSpace(fallbackProductCodes[productCodeKey])
			}
			if productCode == "" {
				return nil, errors.New("Product code configured is not correct. Contact Support")
			}
			asset := assets[summaryLine.ID]
			assignments := asset.ArtworkMaterialAssignments[format.breakdownKey]
			if len(assignments) == 0 {
				artworkImageID := asset.CreativeImageIDs[format.breakdownKey]
				if artworkImageID == "" && format.breakdownKey == "8-sheet" {
					artworkImageID = asset.CreativeImageID
				}
				products = append(products, printIQSheetProduct{FormatKey: format.breakdownKey, ProductCode: productCode, SheetCode: sheetCode, Quantity: printIQQuantity, ArtworkImageID: artworkImageID})
				continue
			}

			remaining := printIQQuantity
			firstProductIndex := len(products)
			for _, assignment := range assignments {
				if assignment.FrameCount <= 0 || remaining <= 0 {
					continue
				}
				assignedQuantity := assignment.FrameCount
				if assignedQuantity > remaining {
					assignedQuantity = remaining
				}
				products = append(products, printIQSheetProduct{FormatKey: format.breakdownKey, ProductCode: productCode, SheetCode: sheetCode, Quantity: assignedQuantity, ArtworkImageID: assignment.ArtworkImageID})
				remaining -= assignedQuantity
			}
			if remaining > 0 && len(products) > firstProductIndex {
				products[len(products)-1].Quantity += remaining
			} else if remaining > 0 {
				products = append(products, printIQSheetProduct{FormatKey: format.breakdownKey, ProductCode: productCode, SheetCode: sheetCode, Quantity: remaining})
			}
		}
	}
	if len(products) == 0 {
		return nil, errors.New("Campaign has no sheet quantities to submit")
	}
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

func (a *app) extractPurchaseOrderUpload(purchaseOrder *purchaseOrderDetails) (*printIQArtworkUpload, error) {
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
	if _, err := os.Stat(filepath.Join(a.uploadDir, storedName)); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, errors.New("Purchase order file not found")
		}
		return nil, err
	}

	purchaseOrderURL := "/api/purchase-orders/" + url.PathEscape(storedName) + "/download"
	appBaseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("APP_BASE_URL")), "/")
	if appBaseURL != "" {
		purchaseOrderURL = appBaseURL + "/" + strings.TrimLeft(purchaseOrderURL, "/")
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

func buildPrintIQUploadArtworkPayload(jobNo string, qstKey any, artwork printIQArtworkUpload, isSupportingDocument, isLastArtworkFile bool) map[string]any {
	return map[string]any{
		"JobNo":                jobNo,
		"ArtworkUrl":           artwork.ArtworkURL,
		"QSTKey":               qstKey,
		"IsSupportingDocument": isSupportingDocument,
		"OverrideFileName":     artwork.OverrideFileName,
		"IsLastArtworkFile":    isLastArtworkFile,
	}
}

func ternaryStringToAny(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
