package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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
	FormatKey   string
	ProductCode string
	Quantity    int
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

func resolvePrintIQSheetProducts(summary *campaignSummary, productCodes map[string]string) ([]printIQSheetProduct, error) {
	if summary == nil {
		return nil, errors.New("Campaign calculation summary is required")
	}
	products := make([]printIQSheetProduct, 0)
	for _, format := range printIQSheetFormatOrder {
		quantity := summary.GrandTotal.Breakdown[format.breakdownKey]
		if quantity <= 0 {
			continue
		}
		productCode := strings.TrimSpace(productCodes[format.settingsKey])
		if productCode == "" {
			return nil, fmt.Errorf("Product Code is required for sheet type %s", format.breakdownKey)
		}
		products = append(products, printIQSheetProduct{
			FormatKey:   format.breakdownKey,
			ProductCode: productCode,
			Quantity:    quantity,
		})
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

func (a *app) extractCampaignArtworkUploads(ctx context.Context, values orderFormValues) ([]printIQArtworkUpload, error) {
	uploads := make([]printIQArtworkUpload, 0, len(values.PrintImages))
	seen := map[string]bool{}
	for index, image := range values.PrintImages {
		artworkURL, err := a.resolvePrintIQArtworkURL(ctx, image)
		if err != nil {
			return nil, err
		}
		if artworkURL == "" || seen[artworkURL] {
			continue
		}
		seen[artworkURL] = true

		overrideFileName := strings.TrimSpace(values.CreativeNameAssignments[image.ID])
		if overrideFileName == "" {
			overrideFileName = strings.TrimSpace(image.Name)
		}
		if overrideFileName == "" {
			overrideFileName = strings.TrimSpace(image.FileName)
		}
		if overrideFileName == "" {
			overrideFileName = fmt.Sprintf("Artwork %d", index+1)
		}
		if ext := filepath.Ext(overrideFileName); ext != "" {
			overrideFileName = strings.TrimSuffix(overrideFileName, ext)
		}

		uploads = append(uploads, printIQArtworkUpload{
			ArtworkURL:       artworkURL,
			OverrideFileName: overrideFileName,
		})
	}
	return uploads, nil
}

func (a *app) resolvePrintIQArtworkURL(ctx context.Context, image campaignPrintImage) (string, error) {
	storedName := strings.TrimSpace(firstNonEmpty(image.SourcePDFStoredName, image.StoredName))
	if storedName != "" {
		if signedURL, ok, err := a.campaignImageReadURL(ctx, storedName, ""); err != nil {
			return "", err
		} else if ok {
			return signedURL, nil
		}
	}

	artworkURL := strings.TrimSpace(firstNonEmpty(image.SourcePDFURL, image.ImageURL))
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
