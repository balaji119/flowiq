package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"image/png"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/pquerna/otp/totp"
)

const (
	twoFactorIssuer       = "ADS Connect"
	twoFactorChallengeTTL = 5 * time.Minute
	twoFactorMaxAttempts  = 5
)

func normalizeTwoFactorCode(code string) string {
	return strings.ReplaceAll(strings.TrimSpace(code), " ", "")
}

func twoFactorTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (a *app) twoFactorEncryptionKey() []byte {
	keyMaterial := strings.TrimSpace(os.Getenv("TWO_FACTOR_SECRET_KEY"))
	if keyMaterial == "" {
		keyMaterial = string(a.jwtSecret)
	}
	sum := sha256.Sum256([]byte(keyMaterial))
	return sum[:]
}

func (a *app) encryptTwoFactorSecret(secret string) (string, error) {
	block, err := aes.NewCipher(a.twoFactorEncryptionKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nil, nonce, []byte(secret), nil)
	payload := append(nonce, ciphertext...)
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func (a *app) decryptTwoFactorSecret(ciphertext string) (string, error) {
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(ciphertext))
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(a.twoFactorEncryptionKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(payload) < gcm.NonceSize() {
		return "", errors.New("invalid two-factor secret")
	}
	nonce := payload[:gcm.NonceSize()]
	encryptedSecret := payload[gcm.NonceSize():]
	secret, err := gcm.Open(nil, nonce, encryptedSecret, nil)
	if err != nil {
		return "", err
	}
	return string(secret), nil
}

func (s *authStore) saveTwoFactorSecretCiphertext(ctx context.Context, userID, ciphertext string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users
		SET two_factor_secret_ciphertext = $2,
		    two_factor_enabled = FALSE,
		    two_factor_enabled_at = NULL,
		    updated_at = NOW()
		WHERE id = $1
	`, userID, ciphertext)
	return err
}

func (s *authStore) twoFactorSecretCiphertext(ctx context.Context, userID string) (string, bool, error) {
	var ciphertext *string
	var enabled bool
	err := s.pool.QueryRow(ctx, `
		SELECT two_factor_secret_ciphertext, two_factor_enabled
		FROM users
		WHERE id = $1
		LIMIT 1
	`, userID).Scan(&ciphertext, &enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, errors.New("User not found")
	}
	if err != nil {
		return "", false, err
	}
	if ciphertext == nil || strings.TrimSpace(*ciphertext) == "" {
		return "", enabled, errors.New("Two-factor authentication is not set up")
	}
	return *ciphertext, enabled, nil
}

func (s *authStore) enableTwoFactor(ctx context.Context, userID string) error {
	commandTag, err := s.pool.Exec(ctx, `
		UPDATE users
		SET two_factor_enabled = TRUE,
		    two_factor_enabled_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1
		  AND two_factor_secret_ciphertext IS NOT NULL
	`, userID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return errors.New("Two-factor authentication is not set up")
	}
	return nil
}

func (s *authStore) disableTwoFactor(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users
		SET two_factor_enabled = FALSE,
		    two_factor_secret_ciphertext = NULL,
		    two_factor_enabled_at = NULL,
		    updated_at = NOW()
		WHERE id = $1
	`, userID)
	return err
}

func (s *authStore) createTwoFactorLoginChallenge(ctx context.Context, userID string, ttl time.Duration) (string, error) {
	rawToken, err := randomHex(32)
	if err != nil {
		return "", err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO two_factor_login_challenges (id, user_id, token_hash, expires_at)
		VALUES ($1, $2, $3, $4)
	`, uuid.NewString(), userID, twoFactorTokenHash(rawToken), time.Now().Add(ttl))
	if err != nil {
		return "", err
	}
	return rawToken, nil
}

type twoFactorChallenge struct {
	ID       string
	UserID   string
	Attempts int
}

func (s *authStore) twoFactorLoginChallenge(ctx context.Context, rawToken string) (*twoFactorChallenge, error) {
	var challenge twoFactorChallenge
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, attempts
		FROM two_factor_login_challenges
		WHERE token_hash = $1
		  AND consumed_at IS NULL
		  AND expires_at > NOW()
		LIMIT 1
	`, twoFactorTokenHash(strings.TrimSpace(rawToken))).Scan(&challenge.ID, &challenge.UserID, &challenge.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &challenge, nil
}

func (s *authStore) recordTwoFactorLoginAttempt(ctx context.Context, challengeID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE two_factor_login_challenges
		SET attempts = attempts + 1,
		    consumed_at = CASE WHEN attempts + 1 >= $2 THEN NOW() ELSE consumed_at END
		WHERE id = $1
	`, challengeID, twoFactorMaxAttempts)
	return err
}

func (s *authStore) consumeTwoFactorLoginChallenge(ctx context.Context, challengeID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE two_factor_login_challenges
		SET consumed_at = NOW()
		WHERE id = $1
	`, challengeID)
	return err
}

func (a *app) handleTwoFactorStatus(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": user.TwoFactorEnabled})
}

func (a *app) handleSetupTwoFactor(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
		return
	}
	if user.TwoFactorEnabled {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Disable two-factor authentication before setting up a new authenticator"})
		return
	}

	issuer := firstNonEmpty(strings.TrimSpace(os.Getenv("TWO_FACTOR_ISSUER")), twoFactorIssuer)
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: user.Email,
		SecretSize:  20,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	ciphertext, err := a.encryptTwoFactorSecret(key.Secret())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := a.authStore.saveTwoFactorSecretCiphertext(r.Context(), user.ID, ciphertext); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	qrImage, err := key.Image(220, 220)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var qrBuffer bytes.Buffer
	if err := png.Encode(&qrBuffer, qrImage); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"secret":        key.Secret(),
		"otpAuthUrl":    key.URL(),
		"qrCodeDataUrl": fmt.Sprintf("data:image/png;base64,%s", base64.StdEncoding.EncodeToString(qrBuffer.Bytes())),
	})
}

func (a *app) handleVerifyTwoFactorSetup(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
		return
	}
	var payload struct {
		Code string `json:"code"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	ciphertext, enabled, err := a.authStore.twoFactorSecretCiphertext(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if enabled {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Two-factor authentication is already enabled"})
		return
	}
	secret, err := a.decryptTwoFactorSecret(ciphertext)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !totp.Validate(normalizeTwoFactorCode(payload.Code), secret) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid authentication code"})
		return
	}
	if err := a.authStore.enableTwoFactor(r.Context(), user.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": true})
}

func (a *app) handleDisableTwoFactor(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
		return
	}
	var payload struct {
		Code string `json:"code"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	if !user.TwoFactorEnabled {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}

	ciphertext, _, err := a.authStore.twoFactorSecretCiphertext(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	secret, err := a.decryptTwoFactorSecret(ciphertext)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !totp.Validate(normalizeTwoFactorCode(payload.Code), secret) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid authentication code"})
		return
	}
	if err := a.authStore.disableTwoFactor(r.Context(), user.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
}

func (a *app) handleVerifyTwoFactorLogin(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ChallengeToken string `json:"challengeToken"`
		Code           string `json:"code"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	challenge, err := a.authStore.twoFactorLoginChallenge(r.Context(), payload.ChallengeToken)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if challenge == nil || challenge.Attempts >= twoFactorMaxAttempts {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Two-factor challenge expired. Sign in again."})
		return
	}

	user, err := a.authStore.userByID(r.Context(), challenge.UserID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if user == nil || !user.Active || !user.TwoFactorEnabled {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Two-factor challenge expired. Sign in again."})
		return
	}

	ciphertext, _, err := a.authStore.twoFactorSecretCiphertext(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	secret, err := a.decryptTwoFactorSecret(ciphertext)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !totp.Validate(normalizeTwoFactorCode(payload.Code), secret) {
		if err := a.authStore.recordTwoFactorLoginAttempt(r.Context(), challenge.ID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid authentication code"})
		return
	}
	if err := a.authStore.consumeTwoFactorLoginChallenge(r.Context(), challenge.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	token, err := a.signAuthToken(*user)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}
