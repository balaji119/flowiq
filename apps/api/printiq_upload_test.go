package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestArtworkSizeLookupDoesNotBlockUpload(t *testing.T) {
	for _, headStatus := range []int{http.StatusOK, http.StatusMethodNotAllowed} {
		t.Run(http.StatusText(headStatus), func(t *testing.T) {
			uploads := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/artwork.pdf" {
					if r.Method != http.MethodHead {
						t.Error("size lookup downloaded artwork")
					}
					w.Header().Set("Content-Length", "86279167")
					w.WriteHeader(headStatus)
					return
				}
				if r.URL.Path != "/api/QuoteProcess/UploadArtworkURL" || r.Method != http.MethodPost {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
				}
				var payload map[string]any
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload["JobNo"] != "J1" {
					t.Error("upload payload changed")
				}
				uploads++
				w.Write([]byte(`{"IsError":false}`))
			}))
			defer server.Close()
			o := newOptionService(server.URL, t.TempDir())
			o.cachedLoginToken = "test"
			o.cacheExpiry = time.Now().Add(time.Minute)
			_, status, err := o.uploadArtworkURL(map[string]any{"JobNo": "J1", "ArtworkUrl": server.URL + "/artwork.pdf"})
			if err != nil || status != http.StatusOK || uploads != 1 {
				t.Fatalf("upload blocked: status=%d uploads=%d err=%v", status, uploads, err)
			}
		})
	}
}
