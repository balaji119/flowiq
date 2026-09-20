package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetPricePostsProductDelivery(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPost || r.URL.Path != "/api/QuoteProcess/GetPrice" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if payload["QuoteNo"] != "Q123" || payload["AcceptQuote"] != false || payload["Deliveries"] == nil || payload["SelectedQuantity"] == nil {
			t.Errorf("unexpected payload: %#v", payload)
		}
		if payload["JobDueDate"] != "2026-09-17" || payload["CustomerExpectedDate"] != "2026-09-17" {
			t.Errorf("missing market-adjusted dates in HTTP request: %#v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ProductKey":22,"QuoteDetails":{"Products":[{"ProductKey":11,"Quantities":[{"MiddlewareProductDetail":{"QQDKey":111}}]},{"ProductKey":22,"Quantities":[{"MiddlewareProductDetail":{"QQDKey":222}}]}]},"IsError":false}`))
	}))
	defer server.Close()
	service := newOptionService(server.URL, t.TempDir())
	service.setCachedLoginToken("test-token")
	payload := buildPrintIQGetPricePayload(orderFormValues{DueDate: "2026-09-21"}, printIQSheetProduct{Market: "Brisbane", ProductCode: "Double", Quantity: 10, DeliveryAddress: "Warehouse\n55 Collins St\nMelbourne VIC 3000\nAustralia"}, "Q123", "C00003")
	response, status, err := service.getPrice(payload)
	if err != nil || status != http.StatusOK || calls != 1 {
		t.Fatalf("calls=%d status=%d error=%v", calls, status, err)
	}
	if key := printIQStringValue(extractGetPriceQQDKey(response)); key != "222" {
		t.Fatalf("wrong proof contact quantity: %s", key)
	}
}

func TestGetPriceDatesByMarket(t *testing.T) {
	for _, tc := range []struct{ market, date, want string }{
		{"Brisbane", "2026-09-21", "2026-09-17"},
		{" qLd ", "2026-01-02", "2025-12-29"},
		{"Sydney", "2026-09-21", "2026-09-19"},
		{"NSW", "2024-03-01", "2024-02-28"},
		{"Melbourne", "2026-09-21", "2026-09-21"},
		{"VIC", " 2026-09-21 ", "2026-09-21"},
		{"", "2026-09-21", "2026-09-21"},
		{"Brisbane", " ", ""},
	} {
		t.Run(tc.market+tc.date, func(t *testing.T) {
			values := orderFormValues{DueDate: tc.date}
			payload := buildPrintIQGetPricePayload(values, printIQSheetProduct{Market: tc.market, Quantity: 1}, "Q123", "C123")
			for _, key := range []string{"JobDueDate", "CustomerExpectedDate"} {
				got, exists := payload[key]
				if tc.want == "" {
					if exists {
						t.Fatalf("blank date should be omitted: %#v", payload)
					}
				} else if got != tc.want {
					t.Fatalf("%s = %v, want %s", key, got, tc.want)
				}
			}
			if values.DueDate != tc.date || payload["QuoteNo"] != "Q123" {
				t.Fatal("date adjustment changed the campaign or quote reference")
			}
		})
	}
}
