package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPrintIQRecoversLostProductAcceptanceAndUploadResponses(t *testing.T) {
	for _, step := range []string{"GetPrice", "AcceptQuote", "UploadArtworkURL"} {
		for _, found := range []bool{false, true} {
			t.Run(step+map[bool]string{false: "/still-uncertain", true: "/found"}[found], func(t *testing.T) {
				plan := printIQMarketPlan{Market: "Sydney", Products: []printIQSheetProduct{{}, {}}}
				product := func(id, qty int, title string) any {
					return map[string]any{"ProductKey": id, "ProductCode": "CODE", "Title": title, "LastAcceptedQQADKey": id + 10, "Quantities": []any{map[string]any{"QuantityKey": id + 20, "Quantity": qty, "Kinds": 1, "IsPriced": true}}}
				}
				first, second := product(1, 1, "First"), product(2, 2, "Second")
				quoteDetails := map[string]any{"QuoteNo": "Q1", "Products": []any{second, first}}
				job := func(id int, name string) any {
					return map[string]any{"ProductKey": id, "QuantityKey": id + 20, "JobNo": name, "Artwork": []any{map[string]any{"Url": "https://example.test/art.pdf", "IsSupportingDocument": false}}}
				}
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var input map[string]any
					_ = json.NewDecoder(r.Body).Decode(&input)
					if !found {
						_ = json.NewEncoder(w).Encode(map[string]any{"IsError": true})
						return
					}
					switch {
					case strings.HasSuffix(r.URL.Path, "/GetQuoteDetails"):
						if input["QuoteNo"] != "Q1" {
							t.Error("lookup used wrong quote")
						}
						_ = json.NewEncoder(w).Encode(map[string]any{"IsError": false, "QuoteDetails": quoteDetails})
					case strings.HasSuffix(r.URL.Path, "/GetAcceptanceDetails"):
						_ = json.NewEncoder(w).Encode(map[string]any{"IsError": false, "AcceptanceDetails": map[string]any{"QuoteNo": "Q1", "Products": []any{job(2, "J2"), job(1, "J1")}}})
					default:
						t.Fatal("recovery sent a mutation", r.URL.Path)
					}
				}))
				defer server.Close()
				service := newOptionService(server.URL, t.TempDir())
				service.setCachedLoginToken("test")
				a := &app{optionService: service}
				journal := &printIQJournal{Steps: map[string]*printIQSavedStep{"Sydney:0": {Name: "CreateQuoteWithDelivery", State: "done", Response: map[string]any{"QuoteDetails": map[string]any{"QuoteNo": "Q1", "Products": []any{first}}}}}, save: func() error { return nil }}
				if step == "AcceptQuote" {
					journal.Steps["Sydney:1"] = &printIQSavedStep{Name: "GetPrice", State: "done", Response: map[string]any{"ProductKey": 2, "QuoteDetails": map[string]any{"Products": []any{second}}}}
				}
				journal.recover = func(key, name string, payload any) (any, bool) {
					return a.recoverPrintIQStep(journal, plan, key, name, payload)
				}
				payload := map[string]any{"QuoteNo": "Q1", "ProductCode": "CODE", "JobTitle": "Second", "SelectedQuantity": map[string]any{"Quantity": 2, "Kinds": 1}, "JobNo": "J1", "ArtworkUrl": "https://example.test/art.pdf", "IsSupportingDocument": false}
				calls := 0
				for submit := 0; submit < 2; submit++ {
					response, failure := journal.run("Sydney:5", step, payload, func() (any, *printIQSubmissionFailure) {
						calls++
						return nil, &printIQSubmissionFailure{Status: 502, Body: map[string]any{"error": "response lost"}}
					})
					if found != (failure == nil) {
						t.Fatalf("recovery result: %#v %v", response, failure)
					}
					if found && step == "AcceptQuote" {
						jobs := extractAcceptedProducts(response)
						if jobs[0].JobNo != "J1" || jobs[1].JobNo != "J2" {
							t.Fatal("recovery reordered jobs and artwork targets")
						}
					}
				}
				if calls != 1 {
					t.Fatal("uncertain mutation replayed")
				}
			})
		}
	}
}
