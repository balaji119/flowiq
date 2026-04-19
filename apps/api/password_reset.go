package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/smtp"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type smtpConfig struct {
	host          string
	port          string
	username      string
	password      string
	fromEmail     string
	fromName      string
	appBaseURL    string
	resetTokenTTL time.Duration
}

func loadSMTPConfig() (smtpConfig, error) {
	host, err := requiredEnv("SMTP_HOST")
	if err != nil {
		return smtpConfig{}, err
	}
	port := firstNonEmpty(strings.TrimSpace(os.Getenv("SMTP_PORT")), "587")
	fromEmail, err := requiredEnv("SMTP_FROM_EMAIL")
	if err != nil {
		return smtpConfig{}, err
	}
	appBaseURL, err := requiredEnv("APP_BASE_URL")
	if err != nil {
		return smtpConfig{}, err
	}

	return smtpConfig{
		host:          host,
		port:          port,
		username:      strings.TrimSpace(os.Getenv("SMTP_USERNAME")),
		password:      strings.TrimSpace(os.Getenv("SMTP_PASSWORD")),
		fromEmail:     fromEmail,
		fromName:      firstNonEmpty(strings.TrimSpace(os.Getenv("SMTP_FROM_NAME")), "ADS Connect"),
		appBaseURL:    strings.TrimRight(appBaseURL, "/"),
		resetTokenTTL: parseDurationOrDefault(firstNonEmpty(strings.TrimSpace(os.Getenv("PASSWORD_RESET_TOKEN_TTL")), "1h"), time.Hour),
	}, nil
}

func passwordResetTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func buildPasswordResetURL(baseURL, token string) string {
	return fmt.Sprintf("%s/reset-password?token=%s", strings.TrimRight(baseURL, "/"), token)
}

func (s *authStore) createPasswordResetToken(ctx context.Context, userID string, expiresAt time.Time) (string, error) {
	rawToken, err := randomHex(32)
	if err != nil {
		return "", err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		UPDATE password_reset_tokens
		SET consumed_at = NOW()
		WHERE user_id = $1 AND consumed_at IS NULL
	`, userID); err != nil {
		return "", err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
		VALUES ($1, $2, $3, $4)
	`, uuid.NewString(), userID, passwordResetTokenHash(rawToken), expiresAt); err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	return rawToken, nil
}

func (s *authStore) resetPasswordWithToken(ctx context.Context, rawToken, newPassword string) error {
	trimmedToken := strings.TrimSpace(rawToken)
	trimmedPassword := strings.TrimSpace(newPassword)
	if trimmedToken == "" || trimmedPassword == "" {
		return fmt.Errorf("token and password are required")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var tokenID string
	var userID string
	err = tx.QueryRow(ctx, `
		SELECT id, user_id
		FROM password_reset_tokens
		WHERE token_hash = $1
		  AND consumed_at IS NULL
		  AND expires_at > NOW()
		LIMIT 1
	`, passwordResetTokenHash(trimmedToken)).Scan(&tokenID, &userID)
	if err == pgx.ErrNoRows {
		return fmt.Errorf("This password reset link is invalid or has expired")
	}
	if err != nil {
		return err
	}

	salt, hash, err := newPasswordHash(trimmedPassword)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET password_salt = $2,
		    password_hash = $3,
		    updated_at = NOW()
		WHERE id = $1
	`, userID, salt, hash); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE password_reset_tokens
		SET consumed_at = NOW()
		WHERE id = $1
	`, tokenID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func sendPasswordResetEmail(cfg smtpConfig, recipientEmail, recipientName, resetURL string) error {
	fromHeader := cfg.fromEmail
	if strings.TrimSpace(cfg.fromName) != "" {
		fromHeader = fmt.Sprintf("%s <%s>", cfg.fromName, cfg.fromEmail)
	}

	subject := "Reset your ADS Connect password"
	body := fmt.Sprintf(
		"Hi %s,\r\n\r\nWe received a request to reset your ADS Connect password.\r\n\r\nUse this link to choose a new password:\r\n%s\r\n\r\nThis link expires in one hour.\r\nIf you did not request this, you can ignore this email.\r\n",
		firstNonEmpty(strings.TrimSpace(recipientName), "there"),
		resetURL,
	)
	message := strings.Join([]string{
		fmt.Sprintf("From: %s", fromHeader),
		fmt.Sprintf("To: %s", recipientEmail),
		fmt.Sprintf("Subject: %s", subject),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		body,
	}, "\r\n")

	address := fmt.Sprintf("%s:%s", cfg.host, cfg.port)
	var auth smtp.Auth
	if cfg.username != "" {
		auth = smtp.PlainAuth("", cfg.username, cfg.password, cfg.host)
	}
	return smtp.SendMail(address, auth, cfg.fromEmail, []string{recipientEmail}, []byte(message))
}
