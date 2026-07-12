package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
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
	Quantity       int
	ArtworkImageID string
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

func resolvePrintIQSheetProducts(values orderFormValues, summary *campaignSummary, productCodesByMarket map[string]map[string]string, fallbackProductCodes map[string]string) ([]printIQSheetProduct, error) {
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
			quantity := summaryLine.Breakdown[format.breakdownKey]
			if quantity <= 0 {
				continue
			}
			productCode := strings.TrimSpace(productCodesByMarket[strings.TrimSpace(summaryLine.Market)][format.settingsKey])
			if productCode == "" {
				productCode = strings.TrimSpace(fallbackProductCodes[format.settingsKey])
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
				products = append(products, printIQSheetProduct{FormatKey: format.breakdownKey, ProductCode: productCode, Quantity: quantity, ArtworkImageID: artworkImageID})
				continue
			}

			divisor := map[string]int{"8-sheet": 4, "QA0": 4, "6-sheet": 3, "4-sheet": 2}[format.breakdownKey]
			if divisor == 0 {
				divisor = 1
			}
			remaining := quantity
			firstProductIndex := len(products)
			for _, assignment := range assignments {
				if assignment.FrameCount <= 0 || remaining <= 0 {
					continue
				}
				assignedQuantity := assignment.FrameCount * divisor
				if assignedQuantity > remaining {
					assignedQuantity = remaining
				}
				products = append(products, printIQSheetProduct{FormatKey: format.breakdownKey, ProductCode: productCode, Quantity: assignedQuantity, ArtworkImageID: assignment.ArtworkImageID})
				remaining -= assignedQuantity
			}
			if remaining > 0 && len(products) > firstProductIndex {
				products[len(products)-1].Quantity += remaining
			} else if remaining > 0 {
				products = append(products, printIQSheetProduct{FormatKey: format.breakdownKey, ProductCode: productCode, Quantity: remaining})
			}
		}
	}
	if len(products) == 0 {
		return nil, errors.New("Campaign has no sheet quantities to submit")
	}
	return products, nil
}

func buildPrintIQGetPriceForProductPayload(product printIQSheetProduct, quoteNo, customerCode string) map[string]any {
	return map[string]any{
		"ProductCode": product.ProductCode,
		"Quantities": []map[string]any{{
			"Quantity": product.Quantity,
			"Kinds":    1,
		}},
		"QuoteNo":          quoteNo,
		"JobTitle":         product.ProductCode,
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

func buildPrintIQCreateQuotePayload(values orderFormValues, summary *campaignSummary) map[string]any {
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
	setStringIfPresent(payload, "JobTitle", values.CampaignName)
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
	if pageNumber <= 0 {
		return "", fmt.Errorf("Source PDF page number is required for artwork %s", strings.TrimSpace(image.Name))
	}
	pdfStoredName := printIQSourcePagePDFStoredName(sourcePDFStoredName, pageNumber)
	if _, err := a.readCampaignImage(ctx, pdfStoredName); err == nil {
		return pdfStoredName, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	sourcePDFBytes, err := a.readCampaignImage(ctx, sourcePDFStoredName)
	if err != nil {
		return "", err
	}
	pdfBytes, err := extractSinglePDFPage(sourcePDFBytes, pageNumber)
	if err != nil {
		return "", err
	}
	if err := a.storeCampaignImage(ctx, pdfStoredName, "application/pdf", pdfBytes); err != nil {
		return "", err
	}
	return pdfStoredName, nil
}

func extractSinglePDFPage(sourcePDFBytes []byte, pageNumber int) ([]byte, error) {
	if pageNumber <= 0 {
		return nil, errors.New("PDF page number must be greater than 0")
	}
	var output []byte
	err := api.ExtractPages(
		bytes.NewReader(sourcePDFBytes),
		[]string{strconv.Itoa(pageNumber)},
		func(reader io.Reader, _ int) error {
			extracted, err := io.ReadAll(reader)
			if err != nil {
				return err
			}
			output = extracted
			return nil
		},
		nil,
	)
	if err != nil {
		return nil, err
	}
	if len(output) == 0 {
		return nil, fmt.Errorf("PDF page %d could not be extracted", pageNumber)
	}
	return output, nil
}

func buildPrintIQUploadArtworkPayload(jobNo string, qstKey any, artwork printIQArtworkUpload, index, total int) map[string]any {
	return map[string]any{
		"JobNo":                jobNo,
		"ArtworkUrl":           artwork.ArtworkURL,
		"QSTKey":               qstKey,
		"IsSupportingDocument": index > 0,
		"OverrideFileName":     artwork.OverrideFileName,
		"IsLastArtworkFile":    index == total-1,
	}
}

func ternaryStringToAny(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
