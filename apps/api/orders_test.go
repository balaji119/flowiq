package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func orderFixture() simpleOrder {
	return simpleOrder{ID: uuid.NewString(), Name: "Station signage", Description: "September order", Lines: []orderLine{
		{ProductID: uuid.NewString(), ProductName: "Banner", ProductCode: "BANNER", Width: 1200, Height: 1800, Quantity: 5, AddressID: uuid.NewString(), Address: "Warehouse\n1 Test Street\nSydney NSW 2000\nAustralia", StoredName: "first.pdf", ArtworkURL: "https://example.test/first.pdf"},
		{ProductID: uuid.NewString(), ProductName: "Poster", ProductCode: "POSTER", Width: 600, Height: 900, Quantity: 12, AddressID: uuid.NewString(), Address: "Office\n2 Other Street\nMelbourne VIC 3000\nAustralia", StoredName: "second.pdf", ArtworkURL: "https://example.test/second.pdf"},
	}}
}

func TestSimpleOrderValidation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*simpleOrder)
	}{
		{"empty name", func(o *simpleOrder) { o.Name = " " }},
		{"no artwork", func(o *simpleOrder) { o.Lines = nil }},
		{"zero width", func(o *simpleOrder) { o.Lines[0].Width = 0 }},
		{"nonfinite height", func(o *simpleOrder) { o.Lines[0].Height = math.Inf(1) }},
		{"negative quantity", func(o *simpleOrder) { o.Lines[0].Quantity = -1 }},
		{"invalid product", func(o *simpleOrder) { o.Lines[0].ProductID = "bad" }},
		{"missing address", func(o *simpleOrder) { o.Lines[0].AddressID = "" }},
		{"path traversal", func(o *simpleOrder) { o.Lines[0].StoredName = "../first.pdf" }},
		{"windows path", func(o *simpleOrder) { o.Lines[0].StoredName = "..\\first.pdf" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o := orderFixture()
			tc.change(&o)
			if validateSimpleOrder(&o) == nil {
				t.Fatal("expected rejection")
			}
		})
	}
	order := orderFixture()
	if err := validateSimpleOrder(&order); err != nil {
		t.Fatal(err)
	}
}

func TestSimpleOrderPrintIQSequence(t *testing.T) {
	order := orderFixture()
	steps := []string{}
	uploads := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		step := strings.TrimPrefix(r.URL.Path, "/api/QuoteProcess/")
		steps = append(steps, step)
		var p map[string]any
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			t.Error(err)
		}
		var response any = map[string]any{"IsError": false}
		switch step {
		case "CreateQuoteWithDelivery":
			if p["CustomerCode"] != "TYPEB" || p["ProductCode"] != "BANNER" || valueAtPath(p, "Quantity", "Quantity") != "5" || valueAtPath(p, "Address", "City") != "Sydney" {
				t.Errorf("incorrect initial payload: %#v", p)
			}
			if !strings.Contains(printIQStringValue(p["Description"]), "1200 mm wide x 1800 mm high") {
				t.Error("missing dimensions")
			}
			if _, ok := p["TargetQuoteFreightPrice"]; ok {
				t.Error("must not force free freight")
			}
			response = map[string]any{"QuoteNo": "QB1", "QQDKey": "first"}
		case "GetPrice":
			if p["QuoteNo"] != "QB1" || p["ProductCode"] != "POSTER" || valueAtPath(p, "SelectedQuantity", "Quantity") != float64(12) {
				t.Errorf("incorrect second line: %#v", p)
			}
			deliveries := p["Deliveries"].([]any)
			if valueAtPath(deliveries[0], "DestinationAddress", "City") != "Melbourne" {
				t.Error("wrong destination")
			}
			response = map[string]any{"ProductKey": 2, "QuoteDetails": map[string]any{"Products": []any{map[string]any{"ProductKey": 2, "QQDKey": "second"}}}}
		case "GetQuoteQuestions":
			response = map[string]any{"QQDPKey": p["QQDKey"]}
		case "SaveQuoteQuestions":
		case "AcceptQuote":
			response = map[string]any{"AcceptanceDetails": map[string]any{"Products": []any{map[string]any{"JobNo": "JB1"}, map[string]any{"JobNo": "JB2"}}}}
		case "UploadArtworkURL":
			uploads = append(uploads, fmt.Sprint(p["JobNo"])+":"+fmt.Sprint(p["ArtworkUrl"]))
		default:
			t.Errorf("unexpected step %s", step)
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	service := newOptionService(server.URL, t.TempDir())
	service.setCachedLoginToken("test")
	checkpoints := 0
	err := (&app{optionService: service}).submitSimpleOrder(&order, TenantRecord{Code: "TYPEB"}, AuthUser{Name: "Test", Email: "test@example.test"}, func(string, any, any) error { checkpoints++; return nil })
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"CreateQuoteWithDelivery", "GetPrice", "GetQuoteQuestions", "GetQuoteQuestions", "SaveQuoteQuestions", "AcceptQuote", "UploadArtworkURL", "UploadArtworkURL"}
	if !reflect.DeepEqual(steps, want) || checkpoints != len(want)*2 {
		t.Fatalf("wrong call order: %v, checkpoints: %d", steps, checkpoints)
	}
	if !reflect.DeepEqual(uploads, []string{"JB1:https://example.test/first.pdf", "JB2:https://example.test/second.pdf"}) {
		t.Fatalf("wrong artwork routing: %v", uploads)
	}
}

func TestSimpleOrderStopsAfterAmbiguousFailure(t *testing.T) {
	order := orderFixture()
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; http.Error(w, "unavailable", 502) }))
	defer server.Close()
	service := newOptionService(server.URL, t.TempDir())
	service.setCachedLoginToken("test")
	err := (&app{optionService: service}).submitSimpleOrder(&order, TenantRecord{Code: "TYPEB"}, AuthUser{}, func(string, any, any) error { return nil })
	if err == nil || calls != 1 {
		t.Fatalf("expected stop after one failed call: err=%v calls=%d", err, calls)
	}
}
