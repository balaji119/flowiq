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
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ProductKey":22,"QuoteDetails":{"Products":[{"ProductKey":11,"Quantities":[{"MiddlewareProductDetail":{"QQDKey":111}}]},{"ProductKey":22,"Quantities":[{"MiddlewareProductDetail":{"QQDKey":222}}]}]},"IsError":false}`))
	}))
	defer server.Close()
	service := newOptionService(server.URL, t.TempDir())
	service.setCachedLoginToken("test-token")
	payload := buildPrintIQGetPricePayload(orderFormValues{}, printIQSheetProduct{ProductCode: "Double", Quantity: 10, DeliveryAddress: "Warehouse\n55 Collins St\nMelbourne VIC 3000\nAustralia"}, "Q123", "C00003")
	response, status, err := service.getPrice(payload)
	if err != nil || status != http.StatusOK || calls != 1 {
		t.Fatalf("calls=%d status=%d error=%v", calls, status, err)
	}
	if key := printIQStringValue(extractGetPriceQQDKey(response)); key != "222" {
		t.Fatalf("wrong proof contact quantity: %s", key)
	}
}
