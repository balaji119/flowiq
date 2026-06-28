package main

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDownloadOneDriveFileResumesExistingPartialFile(t *testing.T) {
	content := bytes.Repeat([]byte("flowiq-onedrive-artwork"), 4096)
	partialSize := 12345
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expectedRange := fmt.Sprintf("bytes=%d-", partialSize)
		if r.Header.Get("Range") != expectedRange {
			t.Errorf("Range header = %q, want %q", r.Header.Get("Range"), expectedRange)
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", partialSize, len(content)-1, len(content)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(content[partialSize:])
	}))
	defer server.Close()

	targetPath := filepath.Join(t.TempDir(), "artwork.pdf")
	if err := os.WriteFile(targetPath, content[:partialSize], 0o600); err != nil {
		t.Fatal(err)
	}
	if err := downloadOneDriveFile(context.Background(), server.URL, targetPath, int64(len(content)), func(int64) {}); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual, content) {
		t.Fatal("resumed download did not match source content")
	}
}

func TestVerifyPDFFileRejectsNonPDF(t *testing.T) {
	path := filepath.Join(t.TempDir(), "not-a-pdf.pdf")
	if err := os.WriteFile(path, []byte("plain text"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifyPDFFile(path); err == nil {
		t.Fatal("verifyPDFFile accepted non-PDF content")
	}
}

func TestOneDriveCredentialEncryptionRoundTrip(t *testing.T) {
	t.Setenv("ONEDRIVE_JOB_ENCRYPTION_KEY", "test-only-stable-worker-key")
	api := &app{jwtSecret: []byte("unused-fallback")}
	encrypted, err := api.encryptOneDriveCredential("short-lived-access-token")
	if err != nil {
		t.Fatal(err)
	}
	if encrypted == "short-lived-access-token" {
		t.Fatal("credential was stored as plaintext")
	}
	decrypted, err := api.decryptOneDriveCredential(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if decrypted != "short-lived-access-token" {
		t.Fatalf("decrypted credential = %q", decrypted)
	}
}
