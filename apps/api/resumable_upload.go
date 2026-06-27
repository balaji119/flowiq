package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

const resumableChunkSize int64 = 8 << 20
const maxResumableUploadSize int64 = 3 << 30

type resumableUploadMetadata struct {
	UploadID     string `json:"uploadId"`
	UserID       string `json:"userId"`
	OriginalName string `json:"originalName"`
	StoredName   string `json:"storedName"`
	MimeType     string `json:"mimeType"`
	Size         int64  `json:"size"`
	ChunkSize    int64  `json:"chunkSize"`
	ChunkCount   int    `json:"chunkCount"`
	CreatedAt    string `json:"createdAt"`
}

func (a *app) resumableUploadRoot() string {
	return filepath.Join(a.campaignImageDir, ".resumable")
}

func (a *app) resumableUploadDir(uploadID string) (string, error) {
	if _, err := uuid.Parse(uploadID); err != nil {
		return "", errors.New("Invalid upload id")
	}
	return filepath.Join(a.resumableUploadRoot(), uploadID), nil
}

func (a *app) loadResumableUpload(r *http.Request) (*resumableUploadMetadata, string, error) {
	user := currentUser(r.Context())
	if user == nil {
		return nil, "", errors.New("Authentication required")
	}
	uploadDir, err := a.resumableUploadDir(strings.TrimSpace(r.PathValue("uploadId")))
	if err != nil {
		return nil, "", err
	}
	encoded, err := os.ReadFile(filepath.Join(uploadDir, "metadata.json"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, "", errors.New("Upload not found")
		}
		return nil, "", err
	}
	var metadata resumableUploadMetadata
	if err := json.Unmarshal(encoded, &metadata); err != nil {
		return nil, "", err
	}
	if metadata.UserID != user.ID {
		return nil, "", errors.New("Upload not found")
	}
	return &metadata, uploadDir, nil
}

func (a *app) handleResumableCampaignImageInit(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
		return
	}
	var payload struct {
		FileName string `json:"fileName"`
		MimeType string `json:"mimeType"`
		Size     int64  `json:"size"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	fileName := strings.TrimSpace(filepath.Base(payload.FileName))
	if fileName == "" || !strings.EqualFold(filepath.Ext(fileName), ".pdf") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Only PDF files are allowed"})
		return
	}
	if payload.Size <= 0 || payload.Size > maxResumableUploadSize {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "PDF size must be between 1 byte and 3 GB"})
		return
	}

	uploadID := uuid.NewString()
	extension := filepath.Ext(fileName)
	baseName := strings.TrimSpace(unsafeFilenamePattern.ReplaceAllString(strings.TrimSuffix(fileName, extension), "_"))
	if baseName == "" {
		baseName = "campaign-artwork"
	}
	if len(baseName) > 64 {
		baseName = baseName[:64]
	}
	metadata := resumableUploadMetadata{
		UploadID:     uploadID,
		UserID:       user.ID,
		OriginalName: fileName,
		StoredName:   fmt.Sprintf("%d-%s%s", time.Now().UnixMilli(), baseName, extension),
		MimeType:     firstNonEmpty(strings.TrimSpace(payload.MimeType), "application/pdf"),
		Size:         payload.Size,
		ChunkSize:    resumableChunkSize,
		ChunkCount:   int((payload.Size + resumableChunkSize - 1) / resumableChunkSize),
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
	}
	uploadDir, _ := a.resumableUploadDir(uploadID)
	if err := os.MkdirAll(uploadDir, 0o700); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to initialize upload"})
		return
	}
	encoded, _ := json.Marshal(metadata)
	if err := os.WriteFile(filepath.Join(uploadDir, "metadata.json"), encoded, 0o600); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to initialize upload"})
		return
	}
	writeJSON(w, http.StatusCreated, metadata)
}

func receivedResumableChunks(uploadDir string, chunkCount int) []int {
	received := make([]int, 0)
	for index := 0; index < chunkCount; index++ {
		if _, err := os.Stat(filepath.Join(uploadDir, fmt.Sprintf("%06d.part", index))); err == nil {
			received = append(received, index)
		}
	}
	return received
}

func (a *app) handleResumableCampaignImageStatus(w http.ResponseWriter, r *http.Request) {
	metadata, uploadDir, err := a.loadResumableUpload(r)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"upload": metadata, "receivedChunks": receivedResumableChunks(uploadDir, metadata.ChunkCount)})
}

func (a *app) handleResumableCampaignImageChunk(w http.ResponseWriter, r *http.Request) {
	metadata, uploadDir, err := a.loadResumableUpload(r)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	index, err := strconv.Atoi(strings.TrimSpace(r.PathValue("chunkIndex")))
	if err != nil || index < 0 || index >= metadata.ChunkCount {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid chunk index"})
		return
	}
	expectedSize := metadata.ChunkSize
	if index == metadata.ChunkCount-1 {
		expectedSize = metadata.Size - int64(index)*metadata.ChunkSize
	}
	temporaryPath := filepath.Join(uploadDir, fmt.Sprintf("%06d.part.tmp", index))
	chunkPath := filepath.Join(uploadDir, fmt.Sprintf("%06d.part", index))
	target, err := os.OpenFile(temporaryPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to store upload chunk"})
		return
	}
	limitedBody := http.MaxBytesReader(w, r.Body, metadata.ChunkSize+1)
	written, copyErr := io.Copy(target, limitedBody)
	closeErr := target.Close()
	if copyErr != nil || closeErr != nil || written != expectedSize {
		_ = os.Remove(temporaryPath)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Upload chunk size is invalid"})
		return
	}
	_ = os.Remove(chunkPath)
	if err := os.Rename(temporaryPath, chunkPath); err != nil {
		_ = os.Remove(temporaryPath)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to finalize upload chunk"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"received": true, "chunkIndex": index})
}

func assembleResumableUpload(uploadDir, targetPath string, metadata *resumableUploadMetadata) error {
	target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer target.Close()
	for index := 0; index < metadata.ChunkCount; index++ {
		chunk, err := os.Open(filepath.Join(uploadDir, fmt.Sprintf("%06d.part", index)))
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(target, chunk)
		closeErr := chunk.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func (a *app) handleResumableCampaignImageComplete(w http.ResponseWriter, r *http.Request) {
	metadata, uploadDir, err := a.loadResumableUpload(r)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	received := receivedResumableChunks(uploadDir, metadata.ChunkCount)
	sort.Ints(received)
	if len(received) != metadata.ChunkCount {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "Upload is incomplete", "receivedChunks": received})
		return
	}

	if a.objectStorage == nil {
		temporaryTarget := filepath.Join(a.campaignImageDir, "."+metadata.StoredName+".assembling")
		if err := assembleResumableUpload(uploadDir, temporaryTarget, metadata); err != nil {
			_ = os.Remove(temporaryTarget)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to assemble uploaded PDF"})
			return
		}
		if err := os.Rename(temporaryTarget, filepath.Join(a.campaignImageDir, metadata.StoredName)); err != nil {
			_ = os.Remove(temporaryTarget)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to finalize uploaded PDF"})
			return
		}
	} else {
		assembledPath := filepath.Join(uploadDir, "assembled.pdf")
		if err := assembleResumableUpload(uploadDir, assembledPath, metadata); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to assemble uploaded PDF"})
			return
		}
		assembled, err := os.Open(assembledPath)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to read assembled PDF"})
			return
		}
		storeErr := a.storeCampaignImageReader(r.Context(), metadata.StoredName, metadata.MimeType, assembled, metadata.Size)
		_ = assembled.Close()
		if storeErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": storeErr.Error()})
			return
		}
	}
	_ = os.RemoveAll(uploadDir)
	writeJSON(w, http.StatusCreated, uploadResponse{
		OriginalName: metadata.OriginalName,
		StoredName:   metadata.StoredName,
		Size:         metadata.Size,
		MimeType:     metadata.MimeType,
		UploadedAt:   time.Now().UTC().Format(time.RFC3339),
		URL:          "/api/campaign-images/" + metadata.StoredName,
	})
}
