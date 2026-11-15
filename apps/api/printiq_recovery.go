package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Validate before a response is checkpointed as done. A missing identifier on
// a mutation is an uncertain outcome, since PrintIQ may have committed it.
func validatePrintIQStepResponse(step string, response any, expectedProducts int) error {
	if response == nil {
		return fmt.Errorf("PrintIQ %s returned an empty response", step)
	}
	if bad, message := printIQResponseError(response); bad {
		return fmt.Errorf("PrintIQ %s: %s", step, message)
	}
	switch step {
	case "CreateQuoteWithDelivery":
		if extractQuoteNo(response) == "" || extractQQDKeyForProductIndex(response, 0) == nil {
			return fmt.Errorf("PrintIQ create quote response did not include QuoteNo and product quantity key")
		}
	case "GetPrice":
		if isZeroValue(valueAtPath(response, "ProductKey")) {
			return fmt.Errorf("PrintIQ pricing response did not include the new ProductKey")
		}
	case "GetQuoteQuestions":
		if extractQQDPKey(response) == nil {
			return fmt.Errorf("PrintIQ quote questions did not include QQDPKey")
		}
	case "AcceptQuote":
		products := extractAcceptedProducts(response)
		if len(products) != expectedProducts || len(products) == 0 {
			return fmt.Errorf("PrintIQ returned %d accepted products for %d submitted product lines", len(products), expectedProducts)
		}
		seen := map[string]bool{}
		for _, product := range products {
			if product.JobNo == "" || seen[product.JobNo] {
				return fmt.Errorf("PrintIQ acceptance did not include distinct job numbers for every product")
			}
			seen[product.JobNo] = true
		}
	case "SaveQuoteQuestions", "UploadArtworkURL":
		// These operations have no downstream identifier, but still require a
		// structured success response instead of an HTML proxy/login page.
		fields, ok := response.(map[string]any)
		if !ok {
			return fmt.Errorf("PrintIQ %s returned an invalid response", step)
		}
		isError, hasFlag := fields["IsError"].(bool)
		if !hasFlag {
			isError, hasFlag = fields["isError"].(bool)
		}
		if !hasFlag || isError {
			return fmt.Errorf("PrintIQ %s did not confirm success", step)
		}
	default:
		return fmt.Errorf("Unsupported PrintIQ step %s", step)
	}
	return nil
}

func printIQFailureHasCreatedEntity(step string, response any) bool {
	switch step {
	case "CreateQuoteWithDelivery":
		return extractQuoteNo(response) != "" || !isZeroValue(valueAtPath(response, "QuoteDetails", "QuoteKey"))
	case "GetPrice":
		products, _ := valueAtPath(response, "QuoteDetails", "Products").([]any)
		return !isZeroValue(valueAtPath(response, "ProductKey")) || len(products) > 0
	case "AcceptQuote":
		return len(extractAcceptedProducts(response)) > 0 || !isZeroValue(valueAtPath(response, "AcceptanceDetails", "AcceptanceKey"))
	}
	return false
}

func (j *printIQJournal) completedResult(campaign *campaignRecord) (map[string]any, error) {
	markets := make([]*printIQMarketSubmission, 0, len(j.Plans))
	quotes, jobs := []string{}, []string{}
	for _, plan := range j.Plans {
		market := &printIQMarketSubmission{Market: plan.Market, DueDate: plan.Values.DueDate}
		for key, step := range j.Steps {
			if !strings.HasPrefix(key, plan.Market+":") || step.State != "done" {
				continue
			}
			switch step.Name {
			case "CreateQuoteWithDelivery":
				market.QuoteNo = extractQuoteNo(step.Response)
			case "AcceptQuote":
				if err := validatePrintIQStepResponse(step.Name, step.Response, len(plan.Products)+len(plan.DeliveryPayloads)); err != nil {
					return nil, err
				}
				for _, product := range extractAcceptedProducts(step.Response) {
					market.JobNos = append(market.JobNos, product.JobNo)
				}
			}
		}
		if market.QuoteNo == "" || len(market.JobNos) == 0 {
			return nil, fmt.Errorf("Completed PrintIQ submission has incomplete saved identifiers. ADS must reconcile the existing quotes/jobs")
		}
		markets = append(markets, market)
		quotes = append(quotes, market.QuoteNo)
		jobs = append(jobs, market.JobNos...)
	}
	if len(quotes) == 0 || len(jobs) == 0 {
		return nil, fmt.Errorf("Completed PrintIQ submission has no saved results")
	}
	return map[string]any{"campaign": campaign, "amount": nil, "quoteNo": quotes[0], "quoteNos": quotes, "marketQuotes": markets, "jobNo": jobs[0], "jobNos": jobs, "test": j.Test}, nil
}

func (j *printIQJournal) submissionStatus() string {
	if j.Completed {
		return "completed"
	}
	status := "running"
	for _, step := range j.Steps {
		if (step.State == "pending" && step.Failure != nil) || step.State == "retryable_timeout" {
			return "needs_reconciliation"
		}
		if step.State == "failed" {
			status = "failed"
		}
	}
	return status
}

func isPrintIQProductMappingFailure(step *printIQSavedStep) bool {
	if step == nil || step.State != "failed" || step.Failure == nil {
		return false
	}
	if printIQFailureHasCreatedEntity(step.Name, step.Response) {
		return false
	}
	message, _ := step.Failure.Body["printIqMessage"].(string)
	message = strings.TrimSpace(message)
	return strings.EqualFold(message, "Product code does not exist.") || strings.EqualFold(message, "Failed to get price for product.")
}

func (step *printIQSavedStep) correctProduct(values orderFormValues, product *printIQSheetProduct, code string) error {
	if !isPrintIQProductMappingFailure(step) || (step.Name != "CreateQuoteWithDelivery" && step.Name != "GetPrice") {
		return fmt.Errorf("Only a confirmed failed product operation can be corrected")
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(step.Payload), &payload); err != nil {
		return err
	}
	if payload == nil {
		return fmt.Errorf("Saved product payload is missing")
	}
	corrected := *product
	corrected.ProductCode = code
	payload["ProductCode"] = code
	payload["JobTitle"] = buildPrintIQJobTitle(values, corrected)
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	step.Payload, *product = string(encoded), corrected
	return nil
}

// Reload only the product codes of confirmed unsuccessful product operations.
// Existing product lines, quote numbers, quantities and attachments stay frozen.
func (a *app) refreshFailedPrintIQMappings(ctx context.Context, campaign *campaignRecord, j *printIQJournal) error {
	needsMappings := false
	for _, step := range j.Steps {
		needsMappings = needsMappings || isPrintIQProductMappingFailure(step)
	}
	if !needsMappings {
		return nil
	}
	settings, err := a.mappingStore.listSheetNameOverrides(ctx, campaign.TenantID)
	if err != nil {
		return err
	}
	mappings, err := a.mappingStore.listMaterialProductMappingsByMarket(ctx, campaign.TenantID)
	if err != nil {
		return err
	}
	products, err := resolvePrintIQSheetProducts(campaign.Values, campaign.Summary, mappings, settings.ProductCodes, settings.CustomSheetSizeFormats)
	if err != nil {
		return err
	}
	for i := range j.Plans {
		plan := &j.Plans[i]
		for index := range plan.Products {
			step := j.Steps[fmt.Sprintf("%s:%d", plan.Market, index)]
			if !isPrintIQProductMappingFailure(step) {
				continue
			}
			original := &plan.Products[index]
			code, err := correctedPrintIQProductCode(*original, products)
			if err != nil {
				return err
			}
			if err := step.correctProduct(plan.Values, original, code); err != nil {
				return err
			}
		}
	}
	return j.save()
}

func correctedPrintIQProductCode(original printIQSheetProduct, products []printIQSheetProduct) (string, error) {
	code := ""
	for _, current := range products {
		candidate := current
		candidate.ProductCode = original.ProductCode
		if candidate != original {
			continue
		}
		if code != "" && code != current.ProductCode {
			return "", fmt.Errorf("Corrected product mapping is ambiguous for %s %s", original.Market, original.FormatKey)
		}
		code = current.ProductCode
	}
	if strings.TrimSpace(code) == "" {
		return "", fmt.Errorf("Mapping changes altered the submitted product grouping for %s %s. ADS must reconcile the existing quote", original.Market, original.FormatKey)
	}
	return code, nil
}

// Reconciliation restores a verified response so normal submission code can
// extract exactly the same identifiers it would have received originally.
func (j *printIQJournal) resolveStep(key, action, note, userID string, response any) error {
	step := j.Steps[key]
	if step == nil || (step.State != "pending" && step.State != "failed" && step.State != "retryable_timeout") {
		return fmt.Errorf("Only an unresolved PrintIQ step can be reconciled")
	}
	if strings.TrimSpace(note) == "" {
		return fmt.Errorf("Record what was verified in PrintIQ")
	}
	switch action {
	case "confirmed_completed":
		expectedProducts := 0
		var marketPlan *printIQMarketPlan
		for i := range j.Plans {
			plan := &j.Plans[i]
			if strings.HasPrefix(key, plan.Market+":") {
				expectedProducts = len(plan.Products) + len(plan.DeliveryPayloads)
				marketPlan = plan
			}
		}
		if err := validatePrintIQStepResponse(step.Name, response, expectedProducts); err != nil {
			return err
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(step.Payload), &payload); err != nil {
			return fmt.Errorf("Unable to validate the saved PrintIQ payload")
		}
		if expectedQuote := printIQStringValue(payload["QuoteNo"]); expectedQuote != "" {
			actualQuote := extractQuoteNo(response)
			if actualQuote == "" {
				actualQuote = printIQStringValue(valueAtPath(response, "AcceptanceDetails", "QuoteNo"))
			}
			if actualQuote != expectedQuote {
				return fmt.Errorf("Verified response must belong to the saved PrintIQ quote %s", expectedQuote)
			}
		}
		if step.Name == "GetPrice" && extractGetPriceQQDKey(response) == nil {
			return fmt.Errorf("Verified pricing response must identify the product quantity")
		}
		if step.Name == "GetPrice" && marketPlan != nil {
			productKey := printIQStringValue(valueAtPath(response, "ProductKey"))
			for savedKey, saved := range j.Steps {
				if saved.State == "done" && strings.HasPrefix(savedKey, marketPlan.Market+":") && printIQCheckpointProductKey(saved) == productKey {
					return fmt.Errorf("Verified pricing response identifies an already completed product")
				}
			}
		}
		if step.Name == "AcceptQuote" {
			if marketPlan == nil {
				return fmt.Errorf("Unable to identify the saved PrintIQ market")
			}
			products, _ := valueAtPath(response, "AcceptanceDetails", "Products").([]any)
			ordered := orderRecoveredPrintIQProducts(j, *marketPlan, products)
			if ordered == nil {
				return fmt.Errorf("Verified jobs must match the saved product and quantity identifiers")
			}
			details, _ := valueAtPath(response, "AcceptanceDetails").(map[string]any)
			details["Products"] = ordered
		}
		step.State, step.Response, step.Failure = "done", response, nil
	case "confirmed_missing":
		step.State = "failed"
		step.Failure = progressFailure("Operation confirmed absent in PrintIQ and no longer processing; ready for retry")
		step.Failure.Body["confirmedMissing"] = true
	default:
		return fmt.Errorf("Action must be confirmed_completed or confirmed_missing")
	}
	j.Resolutions = append(j.Resolutions, printIQUploadResolution{StepKey: key, Action: action, Note: note, UserID: userID, At: time.Now().UTC()})
	return nil
}
