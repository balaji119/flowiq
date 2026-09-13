package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/google/uuid"
)

// Keep the generated PDF available for PrintIQ's URL fetch, using the same storage and public URL path as job artwork.
func (a *app) receivePrintIQVisuals(w http.ResponseWriter, r *http.Request) (*printIQArtworkUpload, error) {
	r.Body = http.MaxBytesReader(w, r.Body, 100<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		return nil, fmt.Errorf("A Visuals PDF is required for PrintIQ submission (maximum request size 100 MB)")
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("visuals")
	if err != nil {
		return nil, fmt.Errorf("A Visuals PDF is required for PrintIQ submission")
	}
	defer file.Close()
	signature := make([]byte, 5)
	if _, err := io.ReadFull(file, signature); err != nil || !bytes.Equal(signature, []byte("%PDF-")) {
		return nil, fmt.Errorf("The Visuals attachment must be a PDF")
	}
	storedName := "campaign-visuals-" + uuid.NewString() + ".pdf"
	if err := a.storeCampaignImageReader(r.Context(), storedName, "application/pdf", io.MultiReader(bytes.NewReader(signature), file), header.Size); err != nil {
		return nil, fmt.Errorf("Unable to store Visuals PDF: %w", err)
	}
	publicURL, err := a.resolvePrintIQArtworkURL(r.Context(), campaignPrintImage{StoredName: storedName})
	if err != nil {
		return nil, err
	}
	parsed, err := url.Parse(publicURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return nil, fmt.Errorf("Configure public artwork storage or APP_BASE_URL so PrintIQ can access the Visuals PDF")
	}
	return &printIQArtworkUpload{ArtworkURL: publicURL, OverrideFileName: "Campaign Visuals"}, nil
}
