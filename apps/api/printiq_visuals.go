package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

// Keep the generated PDF available for PrintIQ's URL fetch, just like the PO.
func (a *app) receivePrintIQVisuals(w http.ResponseWriter, r *http.Request) (*printIQArtworkUpload, error) {
	r.Body = http.MaxBytesReader(w, r.Body, 100<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		return nil, fmt.Errorf("A Visuals PDF is required for PrintIQ submission (maximum request size 100 MB)")
	}
	defer r.MultipartForm.RemoveAll()
	file, _, err := r.FormFile("visuals")
	if err != nil {
		return nil, fmt.Errorf("A Visuals PDF is required for PrintIQ submission")
	}
	defer file.Close()
	signature := make([]byte, 5)
	if _, err := io.ReadFull(file, signature); err != nil || !bytes.Equal(signature, []byte("%PDF-")) {
		return nil, fmt.Errorf("The Visuals attachment must be a PDF")
	}
	storedName := "campaign-visuals-" + uuid.NewString() + ".pdf"
	target := filepath.Join(a.uploadDir, storedName)
	out, err := os.Create(target)
	if err != nil {
		return nil, fmt.Errorf("Unable to store Visuals PDF: %w", err)
	}
	_, copyErr := io.Copy(out, io.MultiReader(bytes.NewReader(signature), file))
	closeErr := out.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(target)
		return nil, fmt.Errorf("Unable to store Visuals PDF")
	}
	upload, err := a.extractPurchaseOrderUpload(r.Context(), &purchaseOrderDetails{StoredName: storedName, OriginalName: "Campaign Visuals.pdf", MimeType: "application/pdf"})
	if err != nil {
		_ = os.Remove(target)
		return nil, err
	}
	return upload, nil
}
