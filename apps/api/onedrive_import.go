package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxOneDriveImportPages = 1000

var pdfInfoPagesPattern = regexp.MustCompile(`(?m)^Pages:\s+(\d+)\s*$`)

type oneDriveImportStore struct {
	pool *pgxpool.Pool
}

type oneDriveImportJob struct {
	ID              string               `json:"id"`
	CampaignID      string               `json:"campaignId"`
	FileName        string               `json:"fileName"`
	Status          string               `json:"status"`
	DownloadedBytes int64                `json:"downloadedBytes"`
	TotalBytes      int64                `json:"totalBytes"`
	ProcessedPages  int                  `json:"processedPages"`
	TotalPages      int                  `json:"totalPages"`
	Images          []campaignPrintImage `json:"images"`
	Error           string               `json:"error,omitempty"`
	CreatedAt       string               `json:"createdAt"`
	UpdatedAt       string               `json:"updatedAt"`
}

type oneDriveItemMetadata struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	ETag        string `json:"eTag"`
	DownloadURL string `json:"@microsoft.graph.downloadUrl"`
	File        *struct {
		MimeType string `json:"mimeType"`
	} `json:"file"`
}

func newOneDriveImportStore(pool *pgxpool.Pool) *oneDriveImportStore {
	return &oneDriveImportStore{pool: pool}
}

func (s *oneDriveImportStore) failInterrupted(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE onedrive_artwork_imports
		SET status = 'error',
			error_message = 'The API restarted while this import was running. Please start the import again.',
			updated_at = NOW()
		WHERE status IN ('queued', 'downloading', 'processing', 'saving')
	`)
	return err
}

func scanOneDriveImportJob(row pgx.Row) (*oneDriveImportJob, error) {
	var job oneDriveImportJob
	var imagesJSON []byte
	var createdAt time.Time
	var updatedAt time.Time
	if err := row.Scan(
		&job.ID,
		&job.CampaignID,
		&job.FileName,
		&job.Status,
		&job.DownloadedBytes,
		&job.TotalBytes,
		&job.ProcessedPages,
		&job.TotalPages,
		&imagesJSON,
		&job.Error,
		&createdAt,
		&updatedAt,
	); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(imagesJSON, &job.Images); err != nil {
		return nil, err
	}
	if job.Images == nil {
		job.Images = []campaignPrintImage{}
	}
	job.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	job.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return &job, nil
}

func (s *oneDriveImportStore) get(ctx context.Context, importID, userID string) (*oneDriveImportJob, error) {
	return scanOneDriveImportJob(s.pool.QueryRow(ctx, `
		SELECT id, campaign_id, file_name, status, downloaded_bytes, total_bytes,
			processed_pages, total_pages, images, error_message, created_at, updated_at
		FROM onedrive_artwork_imports
		WHERE id = $1 AND user_id = $2
	`, importID, userID))
}

func (s *oneDriveImportStore) insert(
	ctx context.Context,
	jobID string,
	user AuthUser,
	campaignID string,
	item oneDriveItemMetadata,
	driveID string,
) (*oneDriveImportJob, error) {
	if user.TenantID == nil {
		return nil, errors.New("current user is not assigned to a tenant")
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO onedrive_artwork_imports (
			id, user_id, tenant_id, campaign_id, drive_id, item_id, item_etag,
			file_name, status, total_bytes
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9)
	`, jobID, user.ID, *user.TenantID, campaignID, driveID, item.ID, item.ETag, item.Name, item.Size)
	if err != nil {
		return nil, err
	}
	return s.get(ctx, jobID, user.ID)
}

func (s *oneDriveImportStore) updateProgress(
	ctx context.Context,
	jobID, status string,
	downloadedBytes int64,
	processedPages, totalPages int,
) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE onedrive_artwork_imports
		SET status = $2,
			downloaded_bytes = GREATEST(downloaded_bytes, $3),
			processed_pages = GREATEST(processed_pages, $4),
			total_pages = GREATEST(total_pages, $5),
			updated_at = NOW()
		WHERE id = $1
	`, jobID, status, downloadedBytes, processedPages, totalPages)
	return err
}

func (s *oneDriveImportStore) complete(ctx context.Context, jobID string, images []campaignPrintImage) error {
	encoded, err := json.Marshal(images)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE onedrive_artwork_imports
		SET status = 'completed', images = $2::jsonb, error_message = '',
			processed_pages = total_pages, downloaded_bytes = total_bytes,
			updated_at = NOW(), completed_at = NOW()
		WHERE id = $1
	`, jobID, string(encoded))
	return err
}

func (s *oneDriveImportStore) fail(ctx context.Context, jobID string, importErr error) {
	message := "Unable to import the OneDrive artwork"
	if importErr != nil && strings.TrimSpace(importErr.Error()) != "" {
		message = importErr.Error()
	}
	_, _ = s.pool.Exec(ctx, `
		UPDATE onedrive_artwork_imports
		SET status = 'error', error_message = $2, updated_at = NOW()
		WHERE id = $1
	`, jobID, message)
}

func fetchOneDriveItem(ctx context.Context, accessToken, driveID, itemID string) (oneDriveItemMetadata, error) {
	endpoint := fmt.Sprintf(
		"https://graph.microsoft.com/v1.0/drives/%s/items/%s",
		url.PathEscape(strings.TrimSpace(driveID)),
		url.PathEscape(strings.TrimSpace(itemID)),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return oneDriveItemMetadata{}, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return oneDriveItemMetadata{}, fmt.Errorf("read OneDrive file details: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		limited, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
			return oneDriveItemMetadata{}, errors.New("OneDrive access expired or this file is not accessible")
		}
		return oneDriveItemMetadata{}, fmt.Errorf("OneDrive returned %s: %s", response.Status, strings.TrimSpace(string(limited)))
	}
	var item oneDriveItemMetadata
	if err := json.NewDecoder(response.Body).Decode(&item); err != nil {
		return oneDriveItemMetadata{}, fmt.Errorf("decode OneDrive file details: %w", err)
	}
	if item.File == nil || (!strings.EqualFold(filepath.Ext(item.Name), ".pdf") && !strings.EqualFold(item.File.MimeType, "application/pdf")) {
		return oneDriveItemMetadata{}, errors.New("Only PDF files can be imported from OneDrive")
	}
	if item.Size <= 0 || item.Size > maxResumableUploadSize {
		return oneDriveItemMetadata{}, errors.New("OneDrive PDF size must be between 1 byte and 3 GB")
	}
	if strings.TrimSpace(item.DownloadURL) == "" {
		return oneDriveItemMetadata{}, errors.New("OneDrive did not provide a download URL for this file")
	}
	return item, nil
}

func (a *app) handleCreateOneDriveArtworkImport(w http.ResponseWriter, r *http.Request) {
	user, resolveErr := a.userWithManagedTenant(r)
	if resolveErr != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": resolveErr.Error()})
		return
	}
	var payload struct {
		CampaignID  string `json:"campaignId"`
		DriveID     string `json:"driveId"`
		ItemID      string `json:"itemId"`
		AccessToken string `json:"accessToken"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	payload.CampaignID = strings.TrimSpace(payload.CampaignID)
	payload.DriveID = strings.TrimSpace(payload.DriveID)
	payload.ItemID = strings.TrimSpace(payload.ItemID)
	payload.AccessToken = strings.TrimSpace(payload.AccessToken)
	if payload.CampaignID == "" || payload.DriveID == "" || payload.ItemID == "" || payload.AccessToken == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "campaignId, driveId, itemId, and accessToken are required"})
		return
	}
	if _, err := a.campaignStore.getCampaign(r.Context(), *user, payload.CampaignID); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	metadataContext, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	item, err := fetchOneDriveItem(metadataContext, payload.AccessToken, payload.DriveID, payload.ItemID)
	cancel()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	jobID := uuid.NewString()
	job, err := a.oneDriveImports.insert(r.Context(), jobID, *user, payload.CampaignID, item, payload.DriveID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to create OneDrive import"})
		return
	}
	go a.runOneDriveArtworkImport(jobID, *user, payload.CampaignID, payload.DriveID, payload.ItemID, payload.AccessToken, item)
	writeJSON(w, http.StatusAccepted, map[string]any{"import": job})
}

func (a *app) handleOneDriveConfig(w http.ResponseWriter, _ *http.Request) {
	clientID := strings.TrimSpace(os.Getenv("ONEDRIVE_CLIENT_ID"))
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":  clientID != "",
		"clientId": clientID,
		"tenantId": firstNonEmpty(strings.TrimSpace(os.Getenv("ONEDRIVE_TENANT_ID")), "organizations"),
	})
}

func (a *app) handleGetOneDriveArtworkImport(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
		return
	}
	job, err := a.oneDriveImports.get(r.Context(), strings.TrimSpace(r.PathValue("importId")), user.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "OneDrive import not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to load OneDrive import"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"import": job})
}

type progressWriter struct {
	written      int64
	lastReported time.Time
	report       func(int64)
}

func (w *progressWriter) Write(content []byte) (int, error) {
	written := len(content)
	w.written += int64(written)
	if time.Since(w.lastReported) >= time.Second {
		w.report(w.written)
		w.lastReported = time.Now()
	}
	return written, nil
}

func downloadOneDriveFile(ctx context.Context, downloadURL, targetPath string, expectedSize int64, report func(int64)) error {
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_RDWR, 0o600)
		if err != nil {
			return err
		}
		info, statErr := target.Stat()
		if statErr != nil {
			_ = target.Close()
			return statErr
		}
		offset := info.Size()
		if offset > expectedSize {
			if err := target.Truncate(0); err != nil {
				_ = target.Close()
				return err
			}
			offset = 0
		}
		if offset == expectedSize {
			report(offset)
			return target.Close()
		}
		if _, err := target.Seek(offset, io.SeekStart); err != nil {
			_ = target.Close()
			return err
		}

		request, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
		if err != nil {
			_ = target.Close()
			return err
		}
		if offset > 0 {
			request.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
		}
		response, requestErr := http.DefaultClient.Do(request)
		if requestErr != nil {
			_ = target.Close()
			lastErr = requestErr
		} else if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
			_ = response.Body.Close()
			_ = target.Close()
			return fmt.Errorf("OneDrive download returned %s", response.Status)
		} else {
			if offset > 0 && response.StatusCode == http.StatusOK {
				// The source ignored Range. Restart cleanly to avoid corrupting the PDF.
				if err := target.Truncate(0); err != nil {
					_ = response.Body.Close()
					_ = target.Close()
					return err
				}
				if _, err := target.Seek(0, io.SeekStart); err != nil {
					_ = response.Body.Close()
					_ = target.Close()
					return err
				}
				offset = 0
			}
			progress := &progressWriter{
				written:      offset,
				lastReported: time.Now(),
				report:       report,
			}
			_, copyErr := io.Copy(target, io.TeeReader(response.Body, progress))
			_ = response.Body.Close()
			syncErr := target.Sync()
			closeErr := target.Close()
			if copyErr == nil && syncErr == nil && closeErr == nil {
				completedInfo, err := os.Stat(targetPath)
				if err == nil && completedInfo.Size() == expectedSize {
					report(expectedSize)
					return nil
				}
				if err == nil {
					lastErr = fmt.Errorf("received %d of %d bytes", completedInfo.Size(), expectedSize)
				} else {
					lastErr = err
				}
			} else {
				lastErr = firstError(copyErr, syncErr, closeErr)
			}
		}
		if attempt < 4 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(1<<attempt) * time.Second):
			}
		}
	}
	return fmt.Errorf("download OneDrive file: %w", lastErr)
}

func firstError(values ...error) error {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return errors.New("unknown error")
}

func verifyPDFFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	reader := bufio.NewReader(file)
	header, err := reader.Peek(5)
	if err != nil {
		return errors.New("The imported file is not a valid PDF")
	}
	if string(header) != "%PDF-" {
		return errors.New("The imported file is not a valid PDF")
	}
	return nil
}

func pdfPageCount(ctx context.Context, pdfPath string) (int, error) {
	command := exec.CommandContext(ctx, "pdfinfo", pdfPath)
	command.Env = append(os.Environ(), "LC_ALL=C")
	output, err := command.CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("read imported PDF: %s", strings.TrimSpace(string(output)))
	}
	match := pdfInfoPagesPattern.FindSubmatch(output)
	if len(match) != 2 {
		return 0, errors.New("Unable to determine the imported PDF page count")
	}
	count, _ := strconv.Atoi(string(match[1]))
	if count <= 0 {
		return 0, errors.New("The imported PDF contains no pages")
	}
	if count > maxOneDriveImportPages {
		return 0, fmt.Errorf("The imported PDF has %d pages; the maximum supported is %d", count, maxOneDriveImportPages)
	}
	return count, nil
}

func renderPDFPage(ctx context.Context, pdfPath, outputPrefix string, page, width, quality int) (string, error) {
	args := []string{
		"-f", strconv.Itoa(page), "-l", strconv.Itoa(page), "-singlefile",
		"-jpeg", "-jpegopt", fmt.Sprintf("quality=%d", quality),
		"-scale-to-x", strconv.Itoa(width), "-scale-to-y", "-1",
		pdfPath, outputPrefix,
	}
	output, err := exec.CommandContext(ctx, "pdftoppm", args...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("render PDF page %d: %s", page, strings.TrimSpace(string(output)))
	}
	renderedPath := outputPrefix + ".jpg"
	if _, err := os.Stat(renderedPath); err != nil {
		return "", fmt.Errorf("render PDF page %d: output file was not created", page)
	}
	return renderedPath, nil
}

func storedArtworkName(base string, page int, suffix string) string {
	safeBase := strings.TrimSpace(unsafeFilenamePattern.ReplaceAllString(base, "_"))
	if safeBase == "" {
		safeBase = "onedrive-artwork"
	}
	if len(safeBase) > 64 {
		safeBase = safeBase[:64]
	}
	return fmt.Sprintf("%d-%s-page-%04d-%s.jpg", time.Now().UnixMilli(), safeBase, page, suffix)
}

func (a *app) runOneDriveArtworkImport(
	jobID string,
	user AuthUser,
	campaignID, driveID, itemID, accessToken string,
	initialItem oneDriveItemMetadata,
) {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Hour)
	defer cancel()
	var storedObjects []string
	completed := false
	defer func() {
		if completed {
			return
		}
		for _, storedName := range storedObjects {
			_ = a.deleteCampaignImage(context.Background(), storedName)
		}
	}()

	if _, err := exec.LookPath("pdfinfo"); err != nil {
		a.oneDriveImports.fail(ctx, jobID, errors.New("Server-side PDF processing is unavailable: pdfinfo is not installed"))
		return
	}
	if _, err := exec.LookPath("pdftoppm"); err != nil {
		a.oneDriveImports.fail(ctx, jobID, errors.New("Server-side PDF processing is unavailable: pdftoppm is not installed"))
		return
	}

	workDir := filepath.Join(a.campaignImageDir, ".onedrive", jobID)
	if err := os.MkdirAll(workDir, 0o700); err != nil {
		a.oneDriveImports.fail(ctx, jobID, fmt.Errorf("prepare OneDrive import: %w", err))
		return
	}
	defer os.RemoveAll(workDir)
	pdfPath := filepath.Join(workDir, "source.pdf")
	_ = a.oneDriveImports.updateProgress(ctx, jobID, "downloading", 0, 0, 0)
	if err := downloadOneDriveFile(ctx, initialItem.DownloadURL, pdfPath, initialItem.Size, func(bytes int64) {
		_ = a.oneDriveImports.updateProgress(context.Background(), jobID, "downloading", bytes, 0, 0)
	}); err != nil {
		// Refresh the short-lived URL once if the first attempt failed before retrying from scratch.
		refreshed, refreshErr := fetchOneDriveItem(ctx, accessToken, driveID, itemID)
		if refreshErr != nil {
			a.oneDriveImports.fail(ctx, jobID, err)
			return
		}
		if retryErr := downloadOneDriveFile(ctx, refreshed.DownloadURL, pdfPath, initialItem.Size, func(bytes int64) {
			_ = a.oneDriveImports.updateProgress(context.Background(), jobID, "downloading", bytes, 0, 0)
		}); retryErr != nil {
			a.oneDriveImports.fail(ctx, jobID, retryErr)
			return
		}
	}
	if err := verifyPDFFile(pdfPath); err != nil {
		a.oneDriveImports.fail(ctx, jobID, err)
		return
	}

	extension := filepath.Ext(initialItem.Name)
	baseName := strings.TrimSuffix(filepath.Base(initialItem.Name), extension)
	safeBase := strings.TrimSpace(unsafeFilenamePattern.ReplaceAllString(baseName, "_"))
	if safeBase == "" {
		safeBase = "onedrive-artwork"
	}
	if len(safeBase) > 64 {
		safeBase = safeBase[:64]
	}
	sourceStoredName := fmt.Sprintf("%d-%s.pdf", time.Now().UnixMilli(), safeBase)
	sourceFile, err := os.Open(pdfPath)
	if err != nil {
		a.oneDriveImports.fail(ctx, jobID, err)
		return
	}
	storeSourceErr := a.storeCampaignImageReader(ctx, sourceStoredName, "application/pdf", sourceFile, initialItem.Size)
	_ = sourceFile.Close()
	if storeSourceErr != nil {
		a.oneDriveImports.fail(ctx, jobID, storeSourceErr)
		return
	}
	storedObjects = append(storedObjects, sourceStoredName)

	totalPages, err := pdfPageCount(ctx, pdfPath)
	if err != nil {
		a.oneDriveImports.fail(ctx, jobID, err)
		return
	}
	_ = a.oneDriveImports.updateProgress(ctx, jobID, "processing", initialItem.Size, 0, totalPages)
	images := make([]campaignPrintImage, 0, totalPages)
	digits := max(2, len(strconv.Itoa(totalPages)))
	for page := 1; page <= totalPages; page++ {
		fullPath, err := renderPDFPage(ctx, pdfPath, filepath.Join(workDir, fmt.Sprintf("page-%04d", page)), page, 2400, 92)
		if err != nil {
			a.oneDriveImports.fail(ctx, jobID, err)
			return
		}
		thumbPath, err := renderPDFPage(ctx, pdfPath, filepath.Join(workDir, fmt.Sprintf("thumb-%04d", page)), page, 320, 75)
		if err != nil {
			a.oneDriveImports.fail(ctx, jobID, err)
			return
		}
		fullStoredName := storedArtworkName(baseName, page, "full")
		thumbStoredName := storedArtworkName(baseName, page, "thumb")
		if err := a.storeFileAsCampaignImage(ctx, fullStoredName, "image/jpeg", fullPath); err != nil {
			a.oneDriveImports.fail(ctx, jobID, err)
			return
		}
		storedObjects = append(storedObjects, fullStoredName)
		if err := a.storeFileAsCampaignImage(ctx, thumbStoredName, "image/jpeg", thumbPath); err != nil {
			a.oneDriveImports.fail(ctx, jobID, err)
			return
		}
		storedObjects = append(storedObjects, thumbStoredName)
		pageSuffix := ""
		imageName := baseName
		if totalPages > 1 {
			pageSuffix = fmt.Sprintf("-page-%0*d", digits, page)
			imageName = fmt.Sprintf("%s (Page %d)", baseName, page)
		}
		images = append(images, campaignPrintImage{
			ID:                  fullStoredName,
			Name:                imageName,
			FileName:            baseName + pageSuffix + ".jpg",
			MimeType:            "image/jpeg",
			StoredName:          fullStoredName,
			ImageURL:            "/api/campaign-images/" + fullStoredName,
			ThumbnailFileName:   baseName + pageSuffix + ".thumb.jpg",
			ThumbnailStoredName: thumbStoredName,
			ThumbnailURL:        "/api/campaign-images/" + thumbStoredName,
			SourcePDFFileName:   initialItem.Name,
			SourcePDFStoredName: sourceStoredName,
			SourcePDFURL:        "/api/campaign-images/" + sourceStoredName,
		})
		_ = os.Remove(fullPath)
		_ = os.Remove(thumbPath)
		_ = a.oneDriveImports.updateProgress(ctx, jobID, "processing", initialItem.Size, page, totalPages)
	}

	_ = a.oneDriveImports.updateProgress(ctx, jobID, "saving", initialItem.Size, totalPages, totalPages)
	if _, err := a.campaignStore.appendCampaignPrintImages(ctx, user, campaignID, images); err != nil {
		a.oneDriveImports.fail(ctx, jobID, err)
		return
	}
	if err := a.oneDriveImports.complete(ctx, jobID, images); err != nil {
		a.oneDriveImports.fail(ctx, jobID, err)
		return
	}
	completed = true
}

func (a *app) storeFileAsCampaignImage(ctx context.Context, storedName, contentType, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	return a.storeCampaignImageReader(ctx, storedName, contentType, file, info.Size())
}
