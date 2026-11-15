package main

import (
	"fmt"
	"strings"
)

// These lookups only adopt an existing positive result. An empty lookup never
// authorizes replay of an uncertain mutation, which could still be processing.
func (a *app) recoverPrintIQStep(j *printIQJournal, plan printIQMarketPlan, key, step string, payload any) (any, bool) {
	fields, _ := payload.(map[string]any)
	lookup := func(endpoint string, input any) (any, bool) {
		response, status, err := a.optionService.postQuoteProcess(endpoint, input)
		bad, _ := printIQResponseError(response)
		return response, err == nil && status >= 200 && status < 300 && !bad && response != nil
	}
	if step == "UploadArtworkURL" {
		if printIQStringValue(fields["JobNo"]) == "" || printIQStringValue(fields["ArtworkUrl"]) == "" {
			return nil, false
		}
		response, ok := lookup("GetAcceptanceDetails", map[string]any{"JobNo": fields["JobNo"]})
		if !ok {
			return nil, false
		}
		products, _ := valueAtPath(response, "AcceptanceDetails", "Products").([]any)
		for _, product := range products {
			if printIQStringValue(valueAtPath(product, "JobNo")) != printIQStringValue(fields["JobNo"]) {
				continue
			}
			artworks, _ := valueAtPath(product, "Artwork").([]any)
			for _, artwork := range artworks {
				if valueAtPath(artwork, "Url") == fields["ArtworkUrl"] && valueAtPath(artwork, "IsSupportingDocument") == fields["IsSupportingDocument"] {
					return map[string]any{"IsError": false, "Recovered": true}, true
				}
			}
		}
		return nil, false
	}
	if step != "GetPrice" && step != "AcceptQuote" && step != "CreateQuoteWithDelivery" {
		return nil, false
	}
	quote := printIQStringValue(fields["QuoteNo"])
	if step == "CreateQuoteWithDelivery" {
		quote = extractQuoteNo(j.Steps[key].Response)
	}
	if quote == "" {
		return nil, false
	}
	response, ok := lookup("GetQuoteDetails", map[string]any{"QuoteNo": quote})
	if !ok || extractQuoteNo(response) != quote {
		return nil, false
	}
	products, _ := valueAtPath(response, "QuoteDetails", "Products").([]any)
	if step == "CreateQuoteWithDelivery" {
		if len(products) != 1 || !matchesPrintIQProduct(products[0], fields, "Quantity") {
			return nil, false
		}
		return response, validatePrintIQStepResponse(step, response, 0) == nil
	}
	// Every preceding product must have a durable, distinct key. This makes
	// repeated identical product codes safe to distinguish by their actual IDs.
	known := map[string]bool{}
	for savedKey, saved := range j.Steps {
		if !strings.HasPrefix(savedKey, plan.Market+":") || saved.State != "done" {
			continue
		}
		if saved.Name != "CreateQuoteWithDelivery" && saved.Name != "GetPrice" {
			continue
		}
		productKey := printIQCheckpointProductKey(saved)
		if productKey == "" || productKey == "0" || known[productKey] {
			return nil, false
		}
		known[productKey] = true
	}
	if len(known) == 0 {
		return nil, false
	}
	if step == "GetPrice" {
		if len(products) != len(known)+1 {
			return nil, false
		}
		var added any
		for _, product := range products {
			id := printIQStringValue(valueAtPath(product, "ProductKey"))
			if known[id] {
				delete(known, id)
			} else if added == nil {
				added = product
			} else {
				return nil, false
			}
		}
		if len(known) != 0 || added == nil || !matchesPrintIQProduct(added, fields, "SelectedQuantity") {
			return nil, false
		}
		result := map[string]any{"IsError": false, "ProductKey": valueAtPath(added, "ProductKey"), "QuoteDetails": valueAtPath(response, "QuoteDetails")}
		return result, validatePrintIQStepResponse(step, result, 0) == nil && extractGetPriceQQDKey(result) != nil
	}
	if len(products) != len(known) {
		return nil, false
	}
	var acceptanceDetailKey any
	for _, product := range products {
		id := printIQStringValue(valueAtPath(product, "ProductKey"))
		if !known[id] || isZeroValue(valueAtPath(product, "LastAcceptedQQADKey")) {
			return nil, false
		}
		delete(known, id)
		acceptanceDetailKey = valueAtPath(product, "LastAcceptedQQADKey")
	}
	accepted, ok := lookup("GetAcceptanceDetails", map[string]any{"AcceptanceDetailKey": acceptanceDetailKey})
	if !ok || printIQStringValue(valueAtPath(accepted, "AcceptanceDetails", "QuoteNo")) != quote {
		return nil, false
	}
	acceptedProducts, _ := valueAtPath(accepted, "AcceptanceDetails", "Products").([]any)
	if len(acceptedProducts) != len(products) {
		return nil, false
	}
	// Preserve the order saved by the product-creation responses, rather than
	// assuming a lookup returns products in the original submission order.
	ordered := orderRecoveredPrintIQProducts(j, plan, acceptedProducts)
	if ordered == nil {
		return nil, false
	}
	result := map[string]any{"IsError": false, "AcceptanceDetails": map[string]any{"QuoteNo": quote, "Products": ordered}}
	return result, validatePrintIQStepResponse(step, result, len(plan.Products)+len(plan.DeliveryPayloads)) == nil
}

func matchesPrintIQProduct(product any, payload map[string]any, quantityField string) bool {
	if printIQStringValue(valueAtPath(product, "ProductCode")) != printIQStringValue(payload["ProductCode"]) || printIQStringValue(valueAtPath(product, "Title")) != printIQStringValue(payload["JobTitle"]) {
		return false
	}
	quantities, _ := valueAtPath(product, "Quantities").([]any)
	if len(quantities) != 1 || valueAtPath(quantities[0], "IsPriced") != true {
		return false
	}
	return printIQStringValue(valueAtPath(quantities[0], "Quantity")) == printIQStringValue(valueAtPath(payload, quantityField, "Quantity")) && printIQStringValue(valueAtPath(quantities[0], "Kinds")) == printIQStringValue(valueAtPath(payload, quantityField, "Kinds"))
}

func orderRecoveredPrintIQProducts(j *printIQJournal, plan printIQMarketPlan, products []any) []any {
	byProduct := map[string]any{}
	for _, product := range products {
		id := printIQStringValue(valueAtPath(product, "ProductKey"))
		if id == "" || id == "0" || byProduct[id] != nil {
			return nil
		}
		byProduct[id] = product
	}
	ordered := []any{}
	for index := 0; index < 2*len(plan.Products)+2+len(plan.DeliveryPayloads); index++ {
		key := fmt.Sprintf("%s:%d", plan.Market, index)
		step := j.Steps[key]
		if step == nil || step.State != "done" || (step.Name != "CreateQuoteWithDelivery" && step.Name != "GetPrice") {
			continue
		}
		id := printIQCheckpointProductKey(step)
		quantityKey := extractGetPriceQQDKey(step.Response)
		if step.Name == "CreateQuoteWithDelivery" {
			quantityKey = extractQQDKeyForProductIndex(step.Response, 0)
		}
		product := byProduct[id]
		if product == nil || quantityKey == nil || printIQStringValue(valueAtPath(product, "QuantityKey")) != printIQStringValue(quantityKey) {
			return nil
		}
		ordered = append(ordered, product)
		delete(byProduct, id)
	}
	if len(ordered) != len(products) {
		return nil
	}
	return ordered
}

func printIQCheckpointProductKey(step *printIQSavedStep) string {
	if step.Name == "GetPrice" {
		return printIQStringValue(valueAtPath(step.Response, "ProductKey"))
	}
	if step.Name == "CreateQuoteWithDelivery" {
		products, _ := valueAtPath(step.Response, "QuoteDetails", "Products").([]any)
		if len(products) > 0 {
			return printIQStringValue(valueAtPath(products[0], "ProductKey"))
		}
	}
	return ""
}
