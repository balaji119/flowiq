package main

import (
	"strconv"
	"strings"
)

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

func buildDefaultJobDescription(values orderFormValues, summary *campaignSummary) string {
	lines := []string{
		"Campaign start: " + firstNonEmpty(values.CampaignStartDate, "TBC"),
		"Run length: " + firstNonEmpty(values.NumberOfWeeks, "0") + " weeks",
		"Substrate: " + values.StockCode,
		"Mode: " + values.ProcessFront,
	}

	if summary != nil {
		lines = append(lines,
			"Poster total: "+strconv.Itoa(summary.GrandTotal.PosterTotal),
			"Frame total: "+strconv.Itoa(summary.GrandTotal.FrameTotal),
			"Special formats: "+strconv.Itoa(summary.GrandTotal.SpecialFormatTotal),
		)
	}
	return strings.Join(lines, "\n")
}

func numberOrZero(value string) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0
	}
	return parsed
}

func buildPrintIQPayload(values orderFormValues, summary *campaignSummary) map[string]any {
	quantity := resolveQuantity(values, summary)
	pages := numberOrZero(values.Pages)
	finishWidth := numberOrZero(values.FinishWidth)
	finishHeight := numberOrZero(values.FinishHeight)
	sectionWidth := numberOrZero(values.SectionWidth)
	sectionHeight := numberOrZero(values.SectionHeight)
	if sectionWidth == 0 {
		sectionWidth = finishWidth
	}
	if sectionHeight == 0 {
		sectionHeight = finishHeight
	}

	resolvedDescription := strings.TrimSpace(values.JobDescription)
	if resolvedDescription == "" {
		resolvedDescription = buildDefaultJobDescription(values, summary)
	}

	sectionOperations := make([]map[string]string, 0, len(values.SelectedSectionOperations))
	for _, operationName := range values.SelectedSectionOperations {
		sectionOperations = append(sectionOperations, map[string]string{"OperationName": operationName})
	}
	jobOperations := make([]map[string]string, 0, len(values.SelectedJobOperations))
	for _, operationName := range values.SelectedJobOperations {
		jobOperations = append(jobOperations, map[string]string{"OperationName": operationName})
	}

	processReverse := strings.TrimSpace(values.ProcessReverse)
	if processReverse == "" {
		processReverse = "None"
	}

	notes := any(nil)
	if strings.TrimSpace(values.Notes) != "" {
		notes = strings.TrimSpace(values.Notes)
	}
	customerExpectedDate := any(nil)
	if strings.TrimSpace(values.DueDate) != "" {
		customerExpectedDate = values.DueDate
	}

	return map[string]any{
		"CustomProduct": map[string]any{
			"ProductCategory":  ternaryStringToAny(values.ProductCategory),
			"FinishSizeWidth":  finishWidth,
			"FinishSizeHeight": finishHeight,
			"Sections": []map[string]any{
				{
					"SectionType":       values.SectionType,
					"StockCode":         values.StockCode,
					"ProcessFront":      values.ProcessFront,
					"ProcessReverse":    processReverse,
					"SectionSizeWidth":  sectionWidth,
					"SectionSizeHeight": sectionHeight,
					"FoldCatalog":       values.FoldCatalog,
					"Pages":             pages,
					"SectionOperations": sectionOperations,
					"SideOperations":    []any{},
				},
			},
			"JobOperations": jobOperations,
		},
		"SelectedQuantity": map[string]any{
			"Quantity":             quantity,
			"Kinds":                0,
			"TargetRetailPrice":    0,
			"TargetWholesalePrice": 0,
			"AdvancedKinds": map[string]any{
				"KindsArePacks": false,
				"Kinds": []map[string]any{
					{
						"Name":     firstNonEmpty(values.KindName, values.CustomerReference, values.CampaignName),
						"Quantity": quantity,
						"Sections": []map[string]int{{"SectionNumber": 1}},
					},
				},
			},
		},
		"QuoteContact": map[string]any{
			"Title":     values.Contact.Title,
			"FirstName": values.Contact.FirstName,
			"Surname":   values.Contact.Surname,
			"Email":     values.Contact.Email,
		},
		"Deliveries":           []any{},
		"TargetFreightPrice":   values.TargetFreightPrice,
		"CustomerCode":         values.CustomerCode,
		"AcceptQuote":          false,
		"JobDescription":       resolvedDescription,
		"JobTitle":             values.CampaignName,
		"Notes":                notes,
		"CustomerExpectedDate": customerExpectedDate,
		"JobDueDate":           nil,
		"CustomerReference":    values.CustomerReference,
	}
}

func ternaryStringToAny(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
