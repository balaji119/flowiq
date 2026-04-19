package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/smtp"
	"net/textproto"
	"path/filepath"
	"strings"
	"time"
)

const maxADSEmailAttachmentBytes = 20 << 20

type emailAttachment struct {
	fileName    string
	contentType string
	content     []byte
}

type creativeEmailLink struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

func loadSMTPAdsToEmail() (string, error) {
	toEmail, err := requiredEnv("SMTP_TO_EMAIL")
	if err != nil {
		return "", err
	}
	return toEmail, nil
}

func sanitizeAttachmentFileName(value string) string {
	baseName := strings.TrimSpace(filepath.Base(value))
	if baseName == "" || baseName == "." || baseName == string(filepath.Separator) {
		return "attachment.xlsx"
	}
	return strings.ReplaceAll(baseName, "\"", "")
}

func writeBase64MimeChunk(target io.Writer, source []byte) error {
	encoded := make([]byte, base64.StdEncoding.EncodedLen(len(source)))
	base64.StdEncoding.Encode(encoded, source)
	for start := 0; start < len(encoded); start += 76 {
		end := start + 76
		if end > len(encoded) {
			end = len(encoded)
		}
		if _, err := target.Write(encoded[start:end]); err != nil {
			return err
		}
		if _, err := target.Write([]byte("\r\n")); err != nil {
			return err
		}
	}
	return nil
}

func sendADSEmailWithAttachments(cfg smtpConfig, toEmail, campaignName, senderName string, attachments []emailAttachment, creativeLinks []creativeEmailLink) error {
	if len(attachments) == 0 {
		return fmt.Errorf("at least one attachment is required")
	}

	fromHeader := cfg.fromEmail
	if strings.TrimSpace(cfg.fromName) != "" {
		fromHeader = fmt.Sprintf("%s <%s>", cfg.fromName, cfg.fromEmail)
	}

	subject := "ADS visuals export"
	if strings.TrimSpace(campaignName) != "" {
		subject = fmt.Sprintf("ADS visuals export - %s", strings.TrimSpace(campaignName))
	}

	requestedBy := "FlowIQ user"
	if strings.TrimSpace(senderName) != "" {
		requestedBy = strings.TrimSpace(senderName)
	}

	bodyLines := []string{
		"Hi Team,",
		"",
		"Please find the generated visuals files attached from ADS Connect.",
		fmt.Sprintf("Requested by: %s", requestedBy),
		fmt.Sprintf("Generated at: %s", time.Now().Format(time.RFC1123Z)),
	}
	if len(creativeLinks) > 0 {
		bodyLines = append(bodyLines, "", "Creative links used in campaign:")
		for index, link := range creativeLinks {
			name := strings.TrimSpace(link.Name)
			url := strings.TrimSpace(link.URL)
			if url == "" {
				continue
			}
			if name == "" {
				name = fmt.Sprintf("Creative %d", index+1)
			}
			bodyLines = append(bodyLines, fmt.Sprintf("- %s: %s", name, url))
		}
	}
	bodyLines = append(bodyLines, "", "Regards,", "ADS Australia")
	bodyText := strings.Join(bodyLines, "\r\n")

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	textPart, err := writer.CreatePart(textproto.MIMEHeader{
		"Content-Type":              {"text/plain; charset=UTF-8"},
		"Content-Transfer-Encoding": {"7bit"},
	})
	if err != nil {
		return err
	}
	if _, err := textPart.Write([]byte(bodyText)); err != nil {
		return err
	}

	for _, attachment := range attachments {
		contentType := strings.TrimSpace(attachment.contentType)
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		fileName := sanitizeAttachmentFileName(attachment.fileName)
		part, err := writer.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {fmt.Sprintf("%s; name=\"%s\"", contentType, fileName)},
			"Content-Disposition":       {fmt.Sprintf("attachment; filename=\"%s\"", fileName)},
			"Content-Transfer-Encoding": {"base64"},
		})
		if err != nil {
			return err
		}
		if err := writeBase64MimeChunk(part, attachment.content); err != nil {
			return err
		}
	}

	if err := writer.Close(); err != nil {
		return err
	}

	messageHeaders := strings.Join([]string{
		fmt.Sprintf("From: %s", fromHeader),
		fmt.Sprintf("To: %s", toEmail),
		fmt.Sprintf("Subject: %s", subject),
		"MIME-Version: 1.0",
		fmt.Sprintf("Content-Type: multipart/mixed; boundary=%q", writer.Boundary()),
		"",
	}, "\r\n")
	message := append([]byte(messageHeaders), body.Bytes()...)

	address := fmt.Sprintf("%s:%s", cfg.host, cfg.port)
	var auth smtp.Auth
	if cfg.username != "" {
		auth = smtp.PlainAuth("", cfg.username, cfg.password, cfg.host)
	}
	return smtp.SendMail(address, auth, cfg.fromEmail, []string{toEmail}, message)
}

func (a *app) handleSendEmailToADS(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(30 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No files uploaded"})
		return
	}

	cfg, err := loadSMTPConfig()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Email is not configured"})
		return
	}

	toEmail, err := loadSMTPAdsToEmail()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "SMTP_TO_EMAIL is not configured"})
		return
	}

	fileHeaders := r.MultipartForm.File["files"]
	if len(fileHeaders) == 0 {
		fileHeaders = r.MultipartForm.File["file"]
	}
	if len(fileHeaders) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No files uploaded"})
		return
	}

	attachments := make([]emailAttachment, 0, len(fileHeaders))
	for _, header := range fileHeaders {
		if header == nil {
			continue
		}
		file, err := header.Open()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Unable to read uploaded files"})
			return
		}
		content, readErr := io.ReadAll(io.LimitReader(file, maxADSEmailAttachmentBytes+1))
		_ = file.Close()
		if readErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Unable to read uploaded files"})
			return
		}
		if len(content) > maxADSEmailAttachmentBytes {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "One or more files are too large to email"})
			return
		}
		contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
		if contentType == "" {
			contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
		}
		attachments = append(attachments, emailAttachment{
			fileName:    header.Filename,
			contentType: contentType,
			content:     content,
		})
	}

	if len(attachments) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No files uploaded"})
		return
	}

	userName := ""
	if user := currentUser(r.Context()); user != nil {
		userName = firstNonEmpty(strings.TrimSpace(user.Name), strings.TrimSpace(user.Email))
	}
	campaignName := strings.TrimSpace(r.FormValue("campaignName"))
	creativeLinksPayload := strings.TrimSpace(r.FormValue("creativeLinks"))
	var creativeLinks []creativeEmailLink
	if creativeLinksPayload != "" {
		if err := json.Unmarshal([]byte(creativeLinksPayload), &creativeLinks); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid creative links payload"})
			return
		}
	}

	if err := sendADSEmailWithAttachments(cfg, toEmail, campaignName, userName, attachments, creativeLinks); err != nil {
		log.Printf("send email to ADS failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("Unable to send email to ADS: %v", err)})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": fmt.Sprintf("Email sent to ADS at %s", toEmail)})
}
