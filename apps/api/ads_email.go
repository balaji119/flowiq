package main

import (
	"bytes"
	"context"
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

func loadProductMappingAlertEmails() ([]string, error) {
	rawRecipients, err := requiredEnv("PRODUCT_MAPPING_ALERT_EMAILS")
	if err != nil {
		return nil, err
	}
	parts := strings.FieldsFunc(rawRecipients, func(value rune) bool {
		return value == ',' || value == ';'
	})
	recipients := make([]string, 0, len(parts))
	for _, part := range parts {
		recipient := strings.TrimSpace(part)
		if recipient != "" {
			recipients = append(recipients, recipient)
		}
	}
	if len(recipients) == 0 {
		return nil, fmt.Errorf("PRODUCT_MAPPING_ALERT_EMAILS is not configured")
	}
	return recipients, nil
}

func sendProductMappingAlertEmail(cfg smtpConfig, recipients []string, tenantName string, mapping calculatorMappingRecord, missing []missingProductMapping, actor AuthUser) error {
	if len(recipients) == 0 || len(missing) == 0 {
		return nil
	}

	fromHeader := cfg.fromEmail
	if strings.TrimSpace(cfg.fromName) != "" {
		fromHeader = fmt.Sprintf("%s <%s>", cfg.fromName, cfg.fromEmail)
	}

	subject := "ADS Connect Product Mapping Required"
	requestedBy := firstNonEmpty(strings.TrimSpace(actor.Name), strings.TrimSpace(actor.Email), "ADS Connect user")
	bodyLines := []string{
		"Hi Team,",
		"",
		"A Quantity Mapping record has active quantities without a matching Product Mapping.",
		"",
		fmt.Sprintf("Tenant: %s", firstNonEmpty(strings.TrimSpace(tenantName), strings.TrimSpace(mapping.TenantID))),
		fmt.Sprintf("Market: %s", strings.TrimSpace(mapping.Market)),
		fmt.Sprintf("Asset: %s", firstNonEmpty(strings.TrimSpace(mapping.Label), strings.TrimSpace(mapping.Asset))),
		fmt.Sprintf("Asset ID: %s", strings.TrimSpace(mapping.ID)),
		fmt.Sprintf("Updated by: %s", requestedBy),
		fmt.Sprintf("Detected at: %s", time.Now().Format(time.RFC1123Z)),
		"",
		"Missing Product Mapping rows:",
	}
	for _, item := range missing {
		bodyLines = append(bodyLines, fmt.Sprintf("- Format: %s, Sheet key: %s", item.FormatKey, item.SheetKey))
	}
	bodyLines = append(bodyLines, "", "Regards,", "ADS Connect")
	bodyText := strings.Join(bodyLines, "\r\n")

	messageHeaders := strings.Join([]string{
		fmt.Sprintf("From: %s", fromHeader),
		fmt.Sprintf("To: %s", strings.Join(recipients, ", ")),
		fmt.Sprintf("Subject: %s", subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 7bit",
		"",
	}, "\r\n")
	message := []byte(messageHeaders + bodyText)

	address := fmt.Sprintf("%s:%s", cfg.host, cfg.port)
	var auth smtp.Auth
	if cfg.username != "" {
		auth = smtp.PlainAuth("", cfg.username, cfg.password, cfg.host)
	}
	return smtp.SendMail(address, auth, cfg.fromEmail, recipients, message)
}

func (a *app) notifyMissingProductMappings(ctx context.Context, tenantID string, mapping calculatorMappingRecord, actor AuthUser) {
	missing, err := a.mappingStore.missingProductMappingsForCalculatorMapping(ctx, tenantID, mapping)
	if err != nil {
		log.Printf("product mapping alert check failed: %v", err)
		return
	}
	if len(missing) == 0 {
		return
	}

	cfg, err := loadSMTPConfig()
	if err != nil {
		log.Printf("product mapping alert email skipped: SMTP is not configured: %v", err)
		return
	}
	recipients, err := loadProductMappingAlertEmails()
	if err != nil {
		log.Printf("product mapping alert email skipped: %v", err)
		return
	}
	tenant, err := a.authStore.getTenant(tenantID)
	tenantName := tenantID
	if err != nil {
		log.Printf("product mapping alert tenant lookup failed: %v", err)
	} else {
		tenantName = tenant.Name
	}
	if err := sendProductMappingAlertEmail(cfg, recipients, tenantName, mapping, missing, actor); err != nil {
		log.Printf("product mapping alert email failed: %v", err)
	}
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
