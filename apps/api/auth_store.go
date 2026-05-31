package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/scrypt"
)

type authStore struct {
	pool *pgxpool.Pool
}

func newAuthStore(pool *pgxpool.Pool) *authStore {
	return &authStore{pool: pool}
}

func randomHex(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func hashPassword(password, salt string) (string, error) {
	hash, err := scrypt.Key([]byte(password), []byte(salt), 16384, 8, 1, 64)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hash), nil
}

func newPasswordHash(password string) (string, string, error) {
	salt, err := randomHex(16)
	if err != nil {
		return "", "", err
	}
	hash, err := hashPassword(password, salt)
	if err != nil {
		return "", "", err
	}
	return salt, hash, nil
}

func verifyPassword(password, salt, expectedHash string) bool {
	hash, err := hashPassword(password, salt)
	if err != nil {
		return false
	}
	hashBytes, err := hex.DecodeString(hash)
	if err != nil {
		return false
	}
	expectedBytes, err := hex.DecodeString(expectedHash)
	if err != nil {
		return false
	}
	if len(hashBytes) != len(expectedBytes) {
		return false
	}
	return subtle.ConstantTimeCompare(hashBytes, expectedBytes) == 1
}

func sanitizeUser(row dbUserRow) AuthUser {
	return AuthUser{
		ID:               row.ID,
		Email:            row.Email,
		Name:             row.Name,
		Role:             row.Role,
		TenantID:         row.TenantID,
		TenantName:       row.TenantName,
		Active:           row.Active,
		TwoFactorEnabled: row.TwoFactorEnabled,
	}
}

type dbUserRow struct {
	ID               string
	TenantID         *string
	TenantName       *string
	Email            string
	Name             string
	Role             string
	Active           bool
	TwoFactorEnabled bool
}

func scanUserRow(scanner interface {
	Scan(dest ...any) error
}) (dbUserRow, string, string, error) {
	var row dbUserRow
	var passwordSalt string
	var passwordHash string
	err := scanner.Scan(
		&row.ID,
		&row.TenantID,
		&row.TenantName,
		&row.Email,
		&row.Name,
		&row.Role,
		&passwordSalt,
		&passwordHash,
		&row.Active,
		&row.TwoFactorEnabled,
	)
	return row, passwordSalt, passwordHash, err
}

func (s *authStore) authenticate(email, password string) (*AuthUser, error) {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	row, passwordSalt, passwordHash, err := scanUserRow(s.pool.QueryRow(context.Background(), `
		SELECT u.id, u.tenant_id, t.name, u.email, u.name, u.role, u.password_salt, u.password_hash, u.active, u.two_factor_enabled
		FROM users u
		LEFT JOIN tenants t ON t.id = u.tenant_id
		WHERE u.email = $1
		LIMIT 1
	`, normalizedEmail))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !row.Active || !verifyPassword(password, passwordSalt, passwordHash) {
		return nil, nil
	}
	user := sanitizeUser(row)
	return &user, nil
}

func (s *authStore) changePasswordWithCredentials(ctx context.Context, email, oldPassword, newPassword string) error {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	trimmedOldPassword := strings.TrimSpace(oldPassword)
	trimmedNewPassword := strings.TrimSpace(newPassword)
	if normalizedEmail == "" || trimmedOldPassword == "" || trimmedNewPassword == "" {
		return errors.New("Email, old password, and new password are required")
	}

	var userID string
	var passwordSalt string
	var passwordHash string
	var active bool
	err := s.pool.QueryRow(ctx, `
		SELECT id, password_salt, password_hash, active
		FROM users
		WHERE email = $1
		LIMIT 1
	`, normalizedEmail).Scan(&userID, &passwordSalt, &passwordHash, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("Invalid email or old password")
	}
	if err != nil {
		return err
	}
	if !active || !verifyPassword(trimmedOldPassword, passwordSalt, passwordHash) {
		return errors.New("Invalid email or old password")
	}

	nextSalt, nextHash, err := newPasswordHash(trimmedNewPassword)
	if err != nil {
		return err
	}

	if _, err := s.pool.Exec(ctx, `
		UPDATE users
		SET password_salt = $2,
		    password_hash = $3,
		    updated_at = NOW()
		WHERE id = $1
	`, userID, nextSalt, nextHash); err != nil {
		return err
	}

	return nil
}

func (s *authStore) touchPresence(ctx context.Context, user AuthUser) error {
	var tenantID any
	if user.TenantID != nil && strings.TrimSpace(*user.TenantID) != "" {
		tenantID = strings.TrimSpace(*user.TenantID)
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO user_presence (user_id, tenant_id, last_seen)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id) DO UPDATE
		SET tenant_id = EXCLUDED.tenant_id,
			last_seen = NOW()
	`, user.ID, tenantID)
	return err
}

func (s *authStore) clearPresence(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM user_presence
		WHERE user_id = $1
	`, userID)
	return err
}

func (s *authStore) countRecentlyActiveUsers(ctx context.Context, tenantID *string, activeWithin time.Duration) (int, error) {
	window := int(activeWithin / time.Second)
	if window < 60 {
		window = 60
	}

	if tenantID != nil && strings.TrimSpace(*tenantID) != "" {
		var count int
		err := s.pool.QueryRow(ctx, `
			SELECT COUNT(*)
			FROM user_presence up
			INNER JOIN users u ON u.id = up.user_id
			WHERE up.tenant_id = $1
			  AND u.active = TRUE
			  AND up.last_seen >= NOW() - ($2 * INTERVAL '1 second')
		`, strings.TrimSpace(*tenantID), window).Scan(&count)
		return count, err
	}

	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM user_presence up
		INNER JOIN users u ON u.id = up.user_id
		WHERE u.active = TRUE
		  AND up.last_seen >= NOW() - ($1 * INTERVAL '1 second')
	`, window).Scan(&count)
	return count, err
}

func (s *authStore) userByEmail(ctx context.Context, email string) (*AuthUser, error) {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	row, _, _, err := scanUserRow(s.pool.QueryRow(ctx, `
		SELECT u.id, u.tenant_id, t.name, u.email, u.name, u.role, u.password_salt, u.password_hash, u.active, u.two_factor_enabled
		FROM users u
		LEFT JOIN tenants t ON t.id = u.tenant_id
		WHERE u.email = $1
		LIMIT 1
	`, normalizedEmail))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	user := sanitizeUser(row)
	return &user, nil
}

func (s *authStore) userByID(ctx context.Context, userID string) (*AuthUser, error) {
	row, _, _, err := scanUserRow(s.pool.QueryRow(ctx, `
		SELECT u.id, u.tenant_id, t.name, u.email, u.name, u.role, u.password_salt, u.password_hash, u.active, u.two_factor_enabled
		FROM users u
		LEFT JOIN tenants t ON t.id = u.tenant_id
		WHERE u.id = $1
		LIMIT 1
	`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	user := sanitizeUser(row)
	return &user, nil
}

func (s *authStore) listTenants() ([]TenantRecord, error) {
	rows, err := s.pool.Query(context.Background(), `
		SELECT
			t.id,
			t.name,
			COUNT(DISTINCT u.id)::int AS user_count,
			COUNT(DISTINCT c.id)::int AS campaign_count,
			t.created_at
		FROM tenants t
		LEFT JOIN users u ON u.tenant_id = t.id
		LEFT JOIN campaigns c ON c.tenant_id = t.id
		GROUP BY t.id, t.name, t.created_at
		ORDER BY t.name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tenants := make([]TenantRecord, 0)
	for rows.Next() {
		var tenant TenantRecord
		var createdAt time.Time
		if err := rows.Scan(&tenant.ID, &tenant.Name, &tenant.UserCount, &tenant.CampaignCount, &createdAt); err != nil {
			return nil, err
		}
		tenant.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		tenants = append(tenants, tenant)
	}
	return tenants, rows.Err()
}

func (s *authStore) createTenant(name string) (*TenantRecord, error) {
	tenantName := strings.TrimSpace(name)
	if tenantName == "" {
		return nil, errors.New("Tenant name is required")
	}

	tenant := TenantRecord{
		ID:            uuid.NewString(),
		Name:          tenantName,
		UserCount:     0,
		CampaignCount: 0,
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
	}
	if _, err := s.pool.Exec(context.Background(), `
		INSERT INTO tenants (id, tenant_id, name, created_at, updated_at)
		VALUES ($1, $1, $2, NOW(), NOW())
	`, tenant.ID, tenant.Name); err != nil {
		return nil, err
	}
	defaultOverridesJSON, err := defaultSheetNameOverridesJSON()
	if err != nil {
		return nil, err
	}
	if _, err := s.pool.Exec(context.Background(), `
		INSERT INTO sheet_name_overrides (tenant_id, overrides, created_at, updated_at)
		VALUES ($1, $2::jsonb, NOW(), NOW())
		ON CONFLICT (tenant_id) DO NOTHING
	`, tenant.ID, defaultOverridesJSON); err != nil {
		return nil, err
	}
	return &tenant, nil
}

func (s *authStore) updateTenant(tenantID, name string) (*TenantRecord, error) {
	trimmedTenantID := strings.TrimSpace(tenantID)
	tenantName := strings.TrimSpace(name)
	if trimmedTenantID == "" {
		return nil, errors.New("tenantId is required")
	}
	if tenantName == "" {
		return nil, errors.New("Tenant name is required")
	}

	var tenant TenantRecord
	var createdAt time.Time
	if err := s.pool.QueryRow(context.Background(), `
		WITH updated_tenant AS (
			UPDATE tenants
			SET name = $2,
				updated_at = NOW()
			WHERE id = $1
			RETURNING id, name, created_at
		)
		SELECT
			t.id,
			t.name,
			COUNT(DISTINCT u.id)::int AS user_count,
			COUNT(DISTINCT c.id)::int AS campaign_count,
			t.created_at
		FROM updated_tenant t
		LEFT JOIN users u ON u.tenant_id = t.id
		LEFT JOIN campaigns c ON c.tenant_id = t.id
		GROUP BY t.id, t.name, t.created_at
	`, trimmedTenantID, tenantName).Scan(&tenant.ID, &tenant.Name, &tenant.UserCount, &tenant.CampaignCount, &createdAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("Tenant not found")
		}
		return nil, err
	}
	tenant.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	return &tenant, nil
}

func (s *authStore) deleteTenant(tenantID string) error {
	trimmedTenantID := strings.TrimSpace(tenantID)
	if trimmedTenantID == "" {
		return errors.New("tenantId is required")
	}

	var assignedUsers int
	if err := s.pool.QueryRow(context.Background(), `
		SELECT COUNT(*)
		FROM users
		WHERE tenant_id = $1
	`, trimmedTenantID).Scan(&assignedUsers); err != nil {
		return err
	}
	if assignedUsers > 0 {
		return errors.New("Tenant has assigned users. Delete or move those users before deleting the tenant")
	}

	var campaigns int
	if err := s.pool.QueryRow(context.Background(), `
		SELECT COUNT(*)
		FROM campaigns
		WHERE tenant_id = $1
	`, trimmedTenantID).Scan(&campaigns); err != nil {
		return err
	}
	if campaigns > 0 {
		return errors.New("Tenant has campaigns. Delete tenant campaigns before deleting the tenant")
	}

	commandTag, err := s.pool.Exec(context.Background(), `
		DELETE FROM tenants
		WHERE id = $1
	`, trimmedTenantID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return errors.New("Tenant not found")
	}
	return nil
}

func (s *authStore) listUsers(tenantID *string, includeSuperAdmins bool) ([]AuthUser, error) {
	baseQuery := `
		SELECT u.id, u.tenant_id, t.name, u.email, u.name, u.role, u.password_salt, u.password_hash, u.active, u.two_factor_enabled
		FROM users u
		LEFT JOIN tenants t ON t.id = u.tenant_id
	`
	args := []any{}
	if tenantID != nil && strings.TrimSpace(*tenantID) != "" {
		if includeSuperAdmins {
			baseQuery += ` WHERE u.tenant_id = $1 OR u.role = 'super_admin'`
		} else {
			baseQuery += ` WHERE u.tenant_id = $1`
		}
		args = append(args, *tenantID)
	}
	baseQuery += ` ORDER BY u.name ASC`

	rows, err := s.pool.Query(context.Background(), baseQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := make([]AuthUser, 0)
	for rows.Next() {
		row, _, _, err := scanUserRow(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, sanitizeUser(row))
	}
	return users, rows.Err()
}

func (s *authStore) createUser(name, email, password, role string, tenantID *string) (*AuthUser, error) {
	normalizedRole := strings.ToLower(strings.TrimSpace(role))
	if normalizedRole != "super_admin" && normalizedRole != "admin" && normalizedRole != "user" {
		return nil, errors.New("Invalid role")
	}
	if strings.TrimSpace(name) == "" || strings.TrimSpace(email) == "" || password == "" {
		return nil, errors.New("name, email, and password are required")
	}

	var normalizedTenantID *string
	if tenantID != nil && strings.TrimSpace(*tenantID) != "" {
		value := strings.TrimSpace(*tenantID)
		normalizedTenantID = &value
	}
	if normalizedRole == "super_admin" {
		normalizedTenantID = nil
	} else if normalizedTenantID == nil {
		return nil, errors.New("tenantId is required for admin and user roles")
	}

	salt, hash, err := newPasswordHash(password)
	if err != nil {
		return nil, err
	}

	userID := uuid.NewString()
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	if _, err := s.pool.Exec(context.Background(), `
		INSERT INTO users (id, tenant_id, email, name, role, password_salt, password_hash, active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW())
	`, userID, normalizedTenantID, normalizedEmail, strings.TrimSpace(name), normalizedRole, salt, hash); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "users_email_key") || strings.Contains(strings.ToLower(err.Error()), "unique") {
			return nil, errors.New("Email already exists")
		}
		return nil, err
	}

	return s.userByID(context.Background(), userID)
}

func (s *authStore) updateUser(userID string, updates map[string]any) (*AuthUser, error) {
	ctx := context.Background()
	row, salt, hash, err := scanUserRow(s.pool.QueryRow(ctx, `
		SELECT u.id, u.tenant_id, t.name, u.email, u.name, u.role, u.password_salt, u.password_hash, u.active, u.two_factor_enabled
		FROM users u
		LEFT JOIN tenants t ON t.id = u.tenant_id
		WHERE u.id = $1
		LIMIT 1
	`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("User not found")
	}
	if err != nil {
		return nil, err
	}

	nextName := row.Name
	nextRole := row.Role
	nextActive := row.Active
	nextTenantID := row.TenantID
	nextSalt := salt
	nextHash := hash

	if name, ok := updates["name"].(string); ok && strings.TrimSpace(name) != "" {
		nextName = strings.TrimSpace(name)
	}
	if role, ok := updates["role"].(string); ok && strings.TrimSpace(role) != "" {
		normalizedRole := strings.ToLower(strings.TrimSpace(role))
		if normalizedRole != "super_admin" && normalizedRole != "admin" && normalizedRole != "user" {
			return nil, errors.New("Invalid role")
		}
		nextRole = normalizedRole
	}
	if active, ok := updates["active"].(bool); ok {
		nextActive = active
	}
	if password, ok := updates["password"].(string); ok && password != "" {
		salt, hash, hashErr := newPasswordHash(password)
		if hashErr != nil {
			return nil, hashErr
		}
		nextSalt = salt
		nextHash = hash
	}
	if tenantID, exists := updates["tenantId"]; exists {
		switch value := tenantID.(type) {
		case string:
			trimmed := strings.TrimSpace(value)
			if trimmed == "" {
				nextTenantID = nil
			} else {
				nextTenantID = &trimmed
			}
		case *string:
			if value == nil || strings.TrimSpace(*value) == "" {
				nextTenantID = nil
			} else {
				trimmed := strings.TrimSpace(*value)
				nextTenantID = &trimmed
			}
		case nil:
			nextTenantID = nil
		default:
			return nil, fmt.Errorf("invalid tenantId")
		}
	}
	if nextRole == "super_admin" {
		nextTenantID = nil
	} else if nextTenantID == nil {
		return nil, errors.New("tenantId is required for admin and user roles")
	}

	if _, err := s.pool.Exec(ctx, `
		UPDATE users
		SET tenant_id = $2,
			name = $3,
			role = $4,
			password_salt = $5,
			password_hash = $6,
			active = $7,
			updated_at = NOW()
		WHERE id = $1
	`, userID, nextTenantID, nextName, nextRole, nextSalt, nextHash, nextActive); err != nil {
		return nil, err
	}

	return s.userByID(ctx, userID)
}

func (s *authStore) deleteUser(userID string) error {
	commandTag, err := s.pool.Exec(context.Background(), `
		DELETE FROM users
		WHERE id = $1
	`, userID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return errors.New("User not found")
	}
	return nil
}
