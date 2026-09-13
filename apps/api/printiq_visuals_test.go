package main

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReceivePrintIQVisuals(t *testing.T) {
	t.Setenv("APP_BASE_URL", "https://flowiq.example")
	for _, tc := range []struct {
		name, content string
		valid         bool
	}{
		{"pdf", "%PDF-1.4\nvisuals export\n%%EOF", true},
		{"not pdf", "<html>error</html>", false},
		{"empty", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			part, err := writer.CreateFormFile("visuals", "Visuals.pdf")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write([]byte(tc.content)); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodPost, "/submit-to-printiq", &body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			dir := t.TempDir()
			a := &app{uploadDir: dir}
			upload, err := a.receivePrintIQVisuals(httptest.NewRecorder(), req)
			if !tc.valid {
				if err == nil {
					t.Fatal("expected invalid PDF rejection")
				}
				entries, _ := os.ReadDir(dir)
				if len(entries) != 0 {
					t.Fatal("invalid PDF was stored")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(upload.ArtworkURL, "https://flowiq.example/api/purchase-orders/campaign-visuals-") {
				t.Fatalf("unexpected URL: %s", upload.ArtworkURL)
			}
			entries, err := os.ReadDir(dir)
			if err != nil || len(entries) != 1 {
				t.Fatalf("expected one retained PDF: %v", err)
			}
			stored, err := os.ReadFile(filepath.Join(dir, entries[0].Name()))
			if err != nil || string(stored) != tc.content {
				t.Fatal("stored PDF differs from generated Visuals")
			}
			payload := buildPrintIQUploadArtworkPayload("JOB-1", *upload, true, false)
			if payload["JobNo"] != "JOB-1" || payload["IsSupportingDocument"] != true || payload["IsLastArtworkFile"] != false {
				t.Fatalf("unexpected supporting document payload: %#v", payload)
			}
		})
	}
}

func TestReceivePrintIQVisualsRequiresAttachment(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/submit-to-printiq", nil)
	if _, err := (&app{uploadDir: t.TempDir()}).receivePrintIQVisuals(httptest.NewRecorder(), req); err == nil {
		t.Fatal("missing Visuals PDF was accepted")
	}
}
