package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPrintIQUploadCheckpointFailureStopsLaterUploads(t *testing.T) {
	for _, failBeforeCall := range []bool{false, true} {
		t.Run(fmt.Sprintf("before_call=%t", failBeforeCall), func(t *testing.T) {
			_, plans := marketSubmissionFixture(t)
			plan := plans[0]
			uploads, checkpointFailed := 0, false
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodHead {
					return
				}
				step := strings.TrimPrefix(r.URL.Path, "/api/QuoteProcess/")
				var response any = map[string]any{"IsError": false}
				switch step {
				case "CreateQuoteWithDelivery":
					response = map[string]any{"QuoteNo": "Q1", "QQDKey": 1}
				case "GetPrice":
					response = map[string]any{"ProductKey": 2, "QuoteDetails": map[string]any{"Products": []any{map[string]any{"ProductKey": 2, "QQDKey": 2}}}}
				case "GetQuoteQuestions":
					response = map[string]any{"QQDPKey": 1}
				case "AcceptQuote":
					response = map[string]any{"AcceptanceDetails": map[string]any{"Products": []any{map[string]any{"JobNo": "J1"}, map[string]any{"JobNo": "J2"}, map[string]any{"JobNo": "J3"}}}}
				case "UploadArtworkURL":
					uploads++
				case "SaveQuoteQuestions":
				default:
					t.Errorf("unexpected call after checkpoint failure: %s", step)
				}
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer server.Close()
			service := newOptionService(server.URL, t.TempDir())
			service.setCachedLoginToken("test")
			a := &app{optionService: service, logDir: t.TempDir()}
			journal := &printIQJournal{Steps: map[string]*printIQSavedStep{}}
			journal.save = func() error {
				step := journal.Steps[journal.CurrentStep]
				if !checkpointFailed && step != nil && step.Name == "UploadArtworkURL" && (failBeforeCall == (step.State == "pending")) {
					checkpointFailed = true
					return errors.New("transient checkpoint failure")
				}
				return nil
			}
			artworks := map[string]*printIQArtworkUpload{}
			for _, product := range plan.Products {
				artworks[product.ArtworkImageID] = &printIQArtworkUpload{ArtworkURL: server.URL + "/file.pdf"}
			}
			_, failure := a.submitPrintIQMarket("test", &campaignRecord{}, AuthUser{}, plan, "C1", &printIQArtworkUpload{ArtworkURL: server.URL + "/po.pdf"}, nil, artworks, journal)
			expectedUploads := 1
			if failBeforeCall {
				expectedUploads = 0
			}
			if !checkpointFailed || failure == nil || failure.Body["stopSubmission"] != true || uploads != expectedUploads {
				t.Fatalf("continued after failed checkpoint: uploads=%d failure=%v", uploads, failure)
			}
		})
	}
}

func TestPrintIQMappingCorrectionKeepsFullProductIdentity(t *testing.T) {
	original := printIQSheetProduct{Market: "Sydney", FormatKey: "8-sheet", ProductCode: "OLD", SheetCode: "A", ArtworkImageID: "art", Quantity: 8, DeliveryAddress: "East"}
	wrong := original
	wrong.ProductCode, wrong.SheetCode, wrong.DeliveryAddress = "WRONG", "B", "West"
	correct := original
	correct.ProductCode = "NEW"
	code, err := correctedPrintIQProductCode(original, []printIQSheetProduct{wrong, correct})
	if err != nil || code != "NEW" {
		t.Fatalf("selected the wrong product sharing artwork/format: %q %v", code, err)
	}
	if _, err := correctedPrintIQProductCode(original, []printIQSheetProduct{wrong}); err == nil {
		t.Fatal("silently changed the identity of the failed product")
	}
	ambiguous := correct
	ambiguous.ProductCode = "OTHER"
	if _, err := correctedPrintIQProductCode(original, []printIQSheetProduct{correct, ambiguous}); err == nil {
		t.Fatal("silently picked an ambiguous product code")
	}
}

func TestPrintIQReconciliationRejectsWrongQuoteAndIncompletePricing(t *testing.T) {
	journal := &printIQJournal{Steps: map[string]*printIQSavedStep{"Sydney:1": {Name: "GetPrice", State: "pending", Payload: `{"QuoteNo":"Q1"}`}}}
	response := map[string]any{"ProductKey": 2, "QuoteDetails": map[string]any{"QuoteNo": "OTHER", "Products": []any{map[string]any{"ProductKey": 2, "QQDKey": 2}}}}
	if err := journal.resolveStep("Sydney:1", "confirmed_completed", "verified", "admin", response); err == nil {
		t.Fatal("accepted a response from another quote")
	}
	response = map[string]any{"QuoteNo": "Q1", "ProductKey": 2}
	if err := journal.resolveStep("Sydney:1", "confirmed_completed", "verified", "admin", response); err == nil {
		t.Fatal("accepted a product without the quantity key required for resume")
	}
	if journal.Steps["Sydney:1"].State != "pending" || len(journal.Resolutions) != 0 {
		t.Fatal("invalid reconciliation modified progress")
	}
}

func TestPrintIQRecoveredResponsesMustPassNormalValidation(t *testing.T) {
	journal := &printIQJournal{
		Steps:    map[string]*printIQSavedStep{},
		save:     func() error { return nil },
		validate: func(step string, response any) error { return validatePrintIQStepResponse(step, response, 1) },
		recover:  func(string, string, any) (any, bool) { return map[string]any{}, true },
	}
	_, failure := journal.run("Sydney:0", "AcceptQuote", map[string]any{}, func() (any, *printIQSubmissionFailure) {
		return nil, &printIQSubmissionFailure{Status: 502, Body: map[string]any{"error": "response lost"}}
	})
	if failure == nil || journal.Steps["Sydney:0"].State != "pending" {
		t.Fatal("invalid recovery bypassed acceptance validation")
	}
}

func TestPrintIQAcceptanceReconciliationPreservesArtworkTargets(t *testing.T) {
	for _, scenario := range []string{"reordered", "wrong quantity", "duplicate product"} {
		t.Run(scenario, func(t *testing.T) {
			journal := &printIQJournal{
				Plans: []printIQMarketPlan{{Market: "Sydney", Products: []printIQSheetProduct{{}, {}}}},
				Steps: map[string]*printIQSavedStep{
					"Sydney:0": {Name: "CreateQuoteWithDelivery", State: "done", Response: map[string]any{"QuoteDetails": map[string]any{"QuoteNo": "Q1", "Products": []any{map[string]any{"ProductKey": 11, "QQDKey": 101}}}}},
					"Sydney:1": {Name: "GetPrice", State: "done", Response: map[string]any{"ProductKey": 22, "QuoteDetails": map[string]any{"Products": []any{map[string]any{"ProductKey": 22, "QQDKey": 202}}}}},
					"Sydney:5": {Name: "AcceptQuote", State: "pending", Payload: `{"QuoteNo":"Q1"}`},
				},
			}
			second := map[string]any{"ProductKey": 22, "QuantityKey": 202, "JobNo": "J2"}
			if scenario == "wrong quantity" {
				second["QuantityKey"] = 999
			}
			if scenario == "duplicate product" {
				second["ProductKey"] = 11
			}
			response := map[string]any{"AcceptanceDetails": map[string]any{"QuoteNo": "Q1", "Products": []any{second, map[string]any{"ProductKey": 11, "QuantityKey": 101, "JobNo": "J1"}}}}
			err := journal.resolveStep("Sydney:5", "confirmed_completed", "Verified existing jobs", "admin", response)
			if scenario != "reordered" {
				if err == nil || journal.Steps["Sydney:5"].State != "pending" || len(journal.Resolutions) != 0 {
					t.Fatal("invalid job identities were accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			jobs := extractAcceptedProducts(journal.Steps["Sydney:5"].Response)
			if jobs[0].JobNo != "J1" || jobs[1].JobNo != "J2" {
				t.Fatal("verified jobs changed artwork targets")
			}
		})
	}
}

func TestPrintIQPricingReconciliationCannotReuseCompletedProduct(t *testing.T) {
	journal := &printIQJournal{Plans: []printIQMarketPlan{{Market: "Sydney", Products: []printIQSheetProduct{{}, {}}}}, Steps: map[string]*printIQSavedStep{
		"Sydney:0": {Name: "CreateQuoteWithDelivery", State: "done", Response: map[string]any{"QuoteDetails": map[string]any{"QuoteNo": "Q1", "Products": []any{map[string]any{"ProductKey": 11, "QQDKey": 101}}}}},
		"Sydney:1": {Name: "GetPrice", State: "pending", Payload: `{"QuoteNo":"Q1"}`},
	}}
	response := map[string]any{"ProductKey": 11, "QuoteDetails": map[string]any{"QuoteNo": "Q1", "Products": []any{map[string]any{"ProductKey": 11, "QQDKey": 101}}}}
	if err := journal.resolveStep("Sydney:1", "confirmed_completed", "Verified", "admin", response); err == nil {
		t.Fatal("earlier product was accepted as the failed addition")
	}
	if journal.Steps["Sydney:1"].State != "pending" {
		t.Fatal("rejected reconciliation modified progress")
	}
}

func TestPrintIQLegacyUploadTimeoutCanBeReconciled(t *testing.T) {
	journal := &printIQJournal{Steps: map[string]*printIQSavedStep{"Sydney:1": {Name: "UploadArtworkURL", State: "retryable_timeout"}}}
	if err := journal.resolveUpload("Sydney:1", "confirmed_uploaded", "Verified exact attachment", "admin"); err != nil {
		t.Fatal(err)
	}
	if journal.Steps["Sydney:1"].State != "done" {
		t.Fatal("legacy timeout could not resume")
	}
}

func TestPrintIQEveryConfirmedFailureResumesExistingQuoteAndJobs(t *testing.T) {
	for _, failedStep := range []string{"CreateQuoteWithDelivery", "GetPrice", "GetQuoteQuestions", "SaveQuoteQuestions", "AcceptQuote", "UploadArtworkURL"} {
		t.Run(failedStep, func(t *testing.T) {
			_, plans := marketSubmissionFixture(t)
			plan := plans[0]
			creates, accepts, products, failures := 0, 0, 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodHead {
					return
				}
				step := strings.TrimPrefix(r.URL.Path, "/api/QuoteProcess/")
				var payload map[string]any
				_ = json.NewDecoder(r.Body).Decode(&payload)
				if step == failedStep && failures < 2 {
					failures++
					_ = json.NewEncoder(w).Encode(map[string]any{"IsError": true, "ErrorMessage": "Rejected"})
					return
				}
				var response any = map[string]any{"IsError": false}
				switch step {
				case "CreateQuoteWithDelivery":
					creates++
					products++
					response = map[string]any{"QuoteNo": "Q1", "QQDKey": 1}
				case "GetPrice":
					if payload["QuoteNo"] != "Q1" {
						t.Error("product added to a different quote")
					}
					products++
					response = map[string]any{"ProductKey": products, "QuoteDetails": map[string]any{"Products": []any{map[string]any{"ProductKey": products, "QQDKey": products}}}}
				case "GetQuoteQuestions":
					response = map[string]any{"QQDPKey": payload["QQDKey"]}
				case "SaveQuoteQuestions", "UploadArtworkURL":
				case "AcceptQuote":
					accepts++
					jobs := []any{}
					for i := 0; i < products; i++ {
						jobs = append(jobs, map[string]any{"JobNo": fmt.Sprintf("J%d", i+1)})
					}
					response = map[string]any{"AcceptanceDetails": map[string]any{"Products": jobs}}
				default:
					t.Errorf("unexpected endpoint %s", step)
				}
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer server.Close()
			service := newOptionService(server.URL, t.TempDir())
			service.setCachedLoginToken("test")
			a := &app{optionService: service, logDir: t.TempDir()}
			artworks := map[string]*printIQArtworkUpload{}
			for _, product := range plan.Products {
				artworks[product.ArtworkImageID] = &printIQArtworkUpload{ArtworkURL: server.URL + "/artwork/" + product.ArtworkImageID}
			}
			journal := &printIQJournal{Plans: []printIQMarketPlan{plan}, Steps: map[string]*printIQSavedStep{}}
			var disk []byte
			journal.save = func() error { var err error; disk, err = json.Marshal(journal); return err }
			_, failure := a.submitPrintIQMarket("first", &campaignRecord{}, AuthUser{}, plan, "C1", nil, nil, artworks, journal)
			if failure == nil || failures != 2 || journal.submissionStatus() != "failed" {
				t.Fatalf("failure did not stop after one retry: %v, failures=%d", failure, failures)
			}
			var restored printIQJournal
			if err := json.Unmarshal(disk, &restored); err != nil {
				t.Fatal(err)
			}
			restored.save = func() error { return nil }
			result, failure := a.submitPrintIQMarket("resume", &campaignRecord{}, AuthUser{}, plan, "C1", nil, nil, artworks, &restored)
			if failure != nil || result.QuoteNo != "Q1" || len(result.JobNos) != 3 {
				t.Fatalf("resume failed: %#v %v", result, failure)
			}
			if creates != 1 || accepts != 1 || products != 3 {
				t.Fatalf("duplicated external work: quotes=%d acceptances=%d products=%d", creates, accepts, products)
			}
			for _, saved := range restored.Steps {
				if saved.State != "done" {
					t.Fatal("resume left an incomplete step")
				}
				if saved.Name == failedStep && len(saved.Attempts) >= 3 && saved.Attempts[0].FinishedAt == nil {
					t.Fatal("lost attempt history across restart")
				}
			}
		})
	}
}

func TestPrintIQStepReconciliationAndCorrectedProduct(t *testing.T) {
	for _, name := range []string{"CreateQuoteWithDelivery", "GetPrice", "AcceptQuote", "UploadArtworkURL"} {
		t.Run(name, func(t *testing.T) {
			response := map[string]any{"IsError": false, "QuoteNo": "Q1", "QQDKey": 1, "ProductKey": 2, "QuoteDetails": map[string]any{"Products": []any{map[string]any{"ProductKey": 2, "QQDKey": 2}}}, "AcceptanceDetails": map[string]any{"Products": []any{map[string]any{"ProductKey": 2, "QuantityKey": 2, "JobNo": "J1"}}}}
			journal := &printIQJournal{Plans: []printIQMarketPlan{{Market: "Sydney", Products: []printIQSheetProduct{{}}}}, Steps: map[string]*printIQSavedStep{"Sydney:0": {Name: name, Payload: `{}`, State: "pending"}}, save: func() error { return nil }}
			key := "Sydney:0"
			if name == "AcceptQuote" {
				key = "Sydney:3"
				journal.Steps[key] = journal.Steps["Sydney:0"]
				journal.Steps["Sydney:0"] = &printIQSavedStep{Name: "CreateQuoteWithDelivery", State: "done", Response: map[string]any{"QuoteDetails": map[string]any{"QuoteNo": "Q1", "Products": []any{map[string]any{"ProductKey": 2, "QQDKey": 2}}}}}
			}
			if err := journal.resolveStep(key, "confirmed_completed", "Verified exact quote/job in PrintIQ", "admin", response); err != nil {
				t.Fatal(err)
			}
			if _, failure := journal.run(key, name, map[string]any{}, func() (any, *printIQSubmissionFailure) { t.Fatal("reconciled operation resent"); return nil, nil }); failure != nil {
				t.Fatal(failure)
			}
			if len(journal.Resolutions) != 1 {
				t.Fatal("missing audit record")
			}
		})
	}
	values := orderFormValues{CampaignName: "Campaign"}
	product := printIQSheetProduct{ProductCode: "OLD", Quantity: 2}
	oldPayload, _ := json.Marshal(buildPrintIQGetPricePayload(values, product, "Q1", "CUSTOMER"))
	journal := &printIQJournal{Steps: map[string]*printIQSavedStep{"Sydney:1": {Name: "GetPrice", State: "failed", Payload: string(oldPayload), Failure: &printIQSubmissionFailure{Body: map[string]any{"printIqMessage": "Product code does not exist."}}}}, save: func() error { return nil }}
	if err := journal.Steps["Sydney:1"].correctProduct(values, &product, "NEW"); err != nil {
		t.Fatal(err)
	}
	newPayload := buildPrintIQGetPricePayload(values, product, "Q1", "CUSTOMER")
	_, failure := journal.run("Sydney:1", "GetPrice", newPayload, func() (any, *printIQSubmissionFailure) { return map[string]any{"ProductKey": 2}, nil })
	if failure != nil {
		t.Fatal("corrected product could not use existing quote", failure)
	}
	if newPayload["JobTitle"] != "C1_NEW-Campaign" {
		t.Fatal("corrected mapping did not update the derived job title")
	}
	newPayload["QuoteNo"] = "Q2"
	if _, failure := journal.run("Sydney:1", "GetPrice", newPayload, func() (any, *printIQSubmissionFailure) { t.Fatal("changed existing quote"); return nil, nil }); failure == nil {
		t.Fatal("allowed completed quote to change")
	}
}

func TestPrintIQRejectsInvalidSuccessBeforeCheckpoint(t *testing.T) {
	for _, name := range []string{"CreateQuoteWithDelivery", "GetPrice", "AcceptQuote", "SaveQuoteQuestions", "UploadArtworkURL"} {
		t.Run(name, func(t *testing.T) {
			if err := validatePrintIQStepResponse(name, map[string]any{}, 1); err == nil {
				t.Fatal("accepted missing required result")
			}
			journal := &printIQJournal{Steps: map[string]*printIQSavedStep{"Sydney:0": {Name: name, State: "done", Payload: `{}`, Response: map[string]any{}}}, save: func() error { return nil }, validate: func(step string, response any) error { return validatePrintIQStepResponse(step, response, 1) }}
			for i := 0; i < 2; i++ {
				_, failure := journal.run("Sydney:0", name, map[string]any{}, func() (any, *printIQSubmissionFailure) {
					t.Fatal("invalid historical mutation resent")
					return nil, nil
				})
				if failure == nil || journal.Steps["Sydney:0"].State != "pending" {
					t.Fatal("invalid saved result not preserved for recovery")
				}
			}
		})
	}
}

func TestPrintIQRetryBudgetResetsOnNextSubmit(t *testing.T) {
	for _, step := range []string{"CreateQuoteWithDelivery", "GetPrice", "GetQuoteQuestions", "SaveQuoteQuestions", "AcceptQuote", "UploadArtworkURL"} {
		journal := &printIQJournal{Steps: map[string]*printIQSavedStep{}, save: func() error { return nil }}
		calls := 0
		for submit := 0; submit < 2; submit++ {
			journal.run("key", step, map[string]any{}, func() (any, *printIQSubmissionFailure) {
				calls++
				return nil, &printIQSubmissionFailure{Status: 400, Body: map[string]any{"printIqMessage": "Rejected"}}
			})
			if calls != 2*(submit+1) {
				t.Fatalf("%s retry budget exceeded or not reset: %d", step, calls)
			}
		}
		if len(journal.Steps["key"].Attempts) != 4 {
			t.Fatal("attempts overwritten")
		}
	}
}

func TestPrintIQPartialErrorResponseDoesNotReplayCreation(t *testing.T) {
	for _, tc := range []struct {
		step     string
		response any
	}{
		{"CreateQuoteWithDelivery", map[string]any{"QuoteNo": "Q1"}},
		{"CreateQuoteWithDelivery", map[string]any{"QuoteDetails": map[string]any{"QuoteKey": 1}}},
		{"GetPrice", map[string]any{"ProductKey": 2}},
		{"GetPrice", map[string]any{"QuoteDetails": map[string]any{"Products": []any{map[string]any{"ProductKey": 2}}}}},
		{"AcceptQuote", map[string]any{"AcceptanceDetails": map[string]any{"Products": []any{map[string]any{"JobNo": "J1"}}}}},
		{"AcceptQuote", map[string]any{"AcceptanceDetails": map[string]any{"AcceptanceKey": 1}}},
	} {
		t.Run(tc.step, func(t *testing.T) {
			journal := &printIQJournal{Steps: map[string]*printIQSavedStep{}, save: func() error { return nil }}
			calls := 0
			for submit := 0; submit < 2; submit++ {
				journal.run("key", tc.step, map[string]any{}, func() (any, *printIQSubmissionFailure) {
					calls++
					return tc.response, &printIQSubmissionFailure{Status: 400, Body: map[string]any{"printIqMessage": "Rejected"}}
				})
			}
			if calls != 1 || journal.submissionStatus() != "needs_reconciliation" {
				t.Fatal("partial success was retried")
			}
		})
	}
}

func TestPrintIQMalformedMutationResponseCannotBeResent(t *testing.T) {
	for _, failedStep := range []string{"CreateQuoteWithDelivery", "GetPrice", "AcceptQuote"} {
		t.Run(failedStep, func(t *testing.T) {
			_, plans := marketSubmissionFixture(t)
			calls := map[string]int{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				step := strings.TrimPrefix(r.URL.Path, "/api/QuoteProcess/")
				calls[step]++
				var response any = map[string]any{"IsError": false}
				if step == failedStep {
					_ = json.NewEncoder(w).Encode(response)
					return
				}
				switch step {
				case "CreateQuoteWithDelivery":
					response = map[string]any{"QuoteNo": "Q1", "QQDKey": 1}
				case "GetPrice":
					response = map[string]any{"ProductKey": 2, "QuoteDetails": map[string]any{"Products": []any{map[string]any{"ProductKey": 2, "QQDKey": 2}}}}
				case "GetQuoteQuestions":
					response = map[string]any{"QQDPKey": 1}
				case "GetQuoteDetails", "GetAcceptanceDetails":
					response = map[string]any{"IsError": true}
				}
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer server.Close()
			service := newOptionService(server.URL, t.TempDir())
			service.setCachedLoginToken("test")
			a := &app{optionService: service, logDir: t.TempDir()}
			journal := &printIQJournal{Steps: map[string]*printIQSavedStep{}, save: func() error { return nil }}
			for submit := 0; submit < 2; submit++ {
				if _, failure := a.submitPrintIQMarket("test", &campaignRecord{}, AuthUser{}, plans[0], "C1", nil, nil, nil, journal); failure == nil {
					t.Fatal("accepted malformed mutation response")
				}
			}
			if calls[failedStep] != 1 {
				t.Fatal("resent a mutation after malformed success")
			}
		})
	}
}
