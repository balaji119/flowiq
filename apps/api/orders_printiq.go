package main

import (
	"fmt"
	"strconv"
)

// Size is passed as explicit production instructions. CreateQuoteWithDelivery's
// product-code contract has no finish-size override (PrintIQ Swagger v0).
func orderPrintIQPayload(order simpleOrder, line orderLine, tenant TenantRecord, user AuthUser, quoteNo string) map[string]any {
	description := fmt.Sprintf("%s\n%s: %g mm wide x %g mm high", order.Description, line.ProductName, line.Width, line.Height)
	values := orderFormValues{CampaignName: order.Name, CustomerCode: tenant.Code, ProductCode: line.ProductCode, Quantity: strconv.Itoa(line.Quantity), JobDescription: description, Contact: contactDetails{FirstName: user.Name, Email: user.Email}}
	product := printIQSheetProduct{ProductCode: line.ProductCode, Quantity: line.Quantity, DeliveryAddress: line.Address}
	var payload map[string]any
	if quoteNo == "" {
		payload = buildPrintIQCreateQuotePayload(values, nil, product, 0)
		// Let PrintIQ calculate delivery pricing for Type B.
		delete(payload, "TargetQuoteFreightPrice")
		payload["Description"] = description
	} else {
		payload = buildPrintIQGetPricePayload(values, product, quoteNo, tenant.Code)
		payload["JobDescription"] = description
		payload["SpecialInstructions"] = description
	}
	payload["JobTitle"] = order.Name + " - " + line.ProductName
	payload["ExternalJobReference"] = order.ID
	return payload
}

func (a *app) submitSimpleOrder(order *simpleOrder, tenant TenantRecord, user AuthUser, checkpoint func(string, any, any) error) error {
	call := func(step string, payload any, send func(any) (any, int, error)) (any, error) {
		// Persist intent first: ambiguous failures must be reconciled, never replayed.
		if err := checkpoint(step+" requested", payload, nil); err != nil {
			return nil, err
		}
		response, status, err := send(payload)
		if saveErr := checkpoint(step, payload, response); saveErr != nil {
			return nil, saveErr
		}
		if err != nil || status < 200 || status >= 300 {
			return nil, fmt.Errorf("%s", printIQStepFailureMessage(step, status, response, err))
		}
		if bad, _ := printIQResponseError(response); bad {
			return nil, fmt.Errorf("%s", printIQStepFailureMessage(step, status, response, nil))
		}
		return response, nil
	}
	qqdKeys := []any{}
	for i, line := range order.Lines {
		payload := orderPrintIQPayload(*order, line, tenant, user, order.QuoteNo)
		if i == 0 {
			response, err := call("CreateQuoteWithDelivery", payload, a.optionService.createQuoteWithDelivery)
			if err != nil {
				return err
			}
			order.QuoteNo = extractQuoteNo(response)
			if order.QuoteNo == "" {
				return fmt.Errorf("PrintIQ returned no quote number")
			}
			qqdKeys = append(qqdKeys, extractQQDKeyForProductIndex(response, 0))
		} else {
			response, err := call("GetPrice", payload, a.optionService.getPrice)
			if err != nil {
				return err
			}
			qqdKeys = append(qqdKeys, extractGetPriceQQDKey(response))
		}
	}
	proofKeys := []any{}
	for _, key := range qqdKeys {
		if key == nil {
			return fmt.Errorf("PrintIQ returned no product quantity key")
		}
		response, err := call("GetQuoteQuestions", buildPrintIQGetQuoteQuestionsPayload(key), a.optionService.getQuoteQuestions)
		if err != nil {
			return err
		}
		proofKey := extractQQDPKey(response)
		if proofKey == nil {
			return fmt.Errorf("PrintIQ returned no proof contact question")
		}
		proofKeys = append(proofKeys, proofKey)
	}
	if _, err := call("SaveQuoteQuestions", buildPrintIQSaveProofContactQuestionsPayload(proofKeys), a.optionService.saveQuoteQuestions); err != nil {
		return err
	}
	accepted, err := call("AcceptQuote", buildPrintIQAcceptQuotePayload(order.QuoteNo, ""), a.optionService.acceptQuote)
	if err != nil {
		return err
	}
	products := extractAcceptedProducts(accepted)
	if len(products) != len(order.Lines) {
		return fmt.Errorf("PrintIQ returned %d jobs for %d artworks", len(products), len(order.Lines))
	}
	order.JobNos = []string{}
	for _, product := range products {
		if product.JobNo == "" {
			return fmt.Errorf("PrintIQ returned a product without a job number")
		}
		order.JobNos = append(order.JobNos, product.JobNo)
	}
	for i, line := range order.Lines {
		payload := buildPrintIQUploadArtworkPayload(order.JobNos[i], printIQArtworkUpload{ArtworkURL: line.ArtworkURL}, false, true)
		if _, err := call("UploadArtworkURL", payload, a.optionService.uploadArtworkURL); err != nil {
			return err
		}
	}
	return nil
}
