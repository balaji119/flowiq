package main

import (
	"strings"
	"testing"
)

func TestPrintIQProductFailureDetails(t *testing.T) {
	for _, product := range []printIQSheetProduct{
		{Market: "VIC", FormatKey: "8-sheet", ProductCode: "Melb Quad"},
		{Market: "NSW", FormatKey: "Delivery", ProductCode: "NSW Delivery"},
	} {
		message := printIQProductFailureDetails("PrintIQ said: Invalid product code", map[string]any{"ProductCode": product.ProductCode}, []printIQSheetProduct{product})
		for _, expected := range []string{"Invalid product code", "market " + product.Market, "sheet type " + product.FormatKey, "ProductCode: " + product.ProductCode} {
			if !strings.Contains(message, expected) {
				t.Fatalf("missing %q in %q", expected, message)
			}
		}
	}
	if got := printIQProductFailureDetails("Upload failed", nil, nil); got != "Upload failed" {
		t.Fatalf("unexpected non-product error: %q", got)
	}
}
