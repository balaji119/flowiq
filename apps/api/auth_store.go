package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/scrypt"
)

type storedUser struct {
	ID           string  `json:"id"`
	TenantID     *string `json:"tenantId"`
	Email        string  `json:"email"`
	Name         string  `json:"name"`
	Role         string  `json:"role"`
	PasswordSalt string  `json:"passwordSalt"`
	PasswordHash string  `json:"passwordHash"`
	Active       bool    `json:"active"`
	CreatedAt    string  `json:"createdAt"`
}

type authStoreFile struct {
	Tenants []TenantRecord `json:"tenants"`
	Users   []storedUser   `json:"users"`
}

type authStore struct {
	path string
	mu   sync.Mutex
}

var slugPattern = regexp.MustCompile(`[^a-z0-9]+`)

func newAuthStore(path string) *authStore {
	return &authStore{path: path}
}

func slugify(value string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	normalized = slugPattern.ReplaceAllString(normalized, "-")
	return strings.Trim(normalized, "-")
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

func (s *authStore) ensureDir() error {
	return os.MkdirAll(filepath.Dir(s.path), 0o755)
}

func (s *authStore) createSeedStore() (authStoreFile, error) {
	tenantName := envOrDefault("DEFAULT_TENANT_NAME", "ADS")
	tenant := TenantRecord{
		ID:        uuid.NewString(),
		Name:      tenantName,
		Slug:      slugify(tenantName),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	salt, hash, err := newPasswordHash(envOrDefault("SUPER_ADMIN_PASSWORD", "admin"))
	if err != nil {
		return authStoreFile{}, err
	}

	return authStoreFile{
		Tenants: []TenantRecord{tenant},
		Users: []storedUser{
			{
				ID:           uuid.NewString(),
				TenantID:     nil,
				Email:        strings.ToLower(envOrDefault("SUPER_ADMIN_EMAIL", "admin")),
				Name:         envOrDefault("SUPER_ADMIN_NAME", "FlowIQ Administrator"),
				Role:         "super_admin",
				PasswordSalt: salt,
				PasswordHash: hash,
				Active:       true,
				CreatedAt:    time.Now().UTC().Format(time.RFC3339),
			},
		},
	}, nil
}

func (s *authStore) load() (authStoreFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureDir(); err != nil {
		return authStoreFile{}, err
	}
	if _, err := os.Stat(s.path); errors.Is(err, os.ErrNotExist) {
		seed, createErr := s.createSeedStore()
		if createErr != nil {
			return authStoreFile{}, createErr
		}
		if err := s.writeLocked(seed); err != nil {
			return authStoreFile{}, err
		}
		return seed, nil
	}

	bytes, err := os.ReadFile(s.path)
	if err != nil {
		return authStoreFile{}, err
	}

	var store authStoreFile
	if err := json.Unmarshal(bytes, &store); err != nil {
		return authStoreFile{}, err
	}
	if store.Tenants == nil {
		store.Tenants = []TenantRecord{}
	}
	if store.Users == nil {
		store.Users = []storedUser{}
	}
	return store, nil
}

func (s *authStore) save(store authStoreFile) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.writeLocked(store)
}

func (s *authStore) writeLocked(store authStoreFile) error {
	if err := s.ensureDir(); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, bytes, 0o644)
}

func sanitizeUser(user storedUser, tenant *TenantRecord) AuthUser {
	result := AuthUser{
		ID:     user.ID,
		Email:  user.Email,
		Name:   user.Name,
		Role:   user.Role,
		Active: user.Active,
	}
	if user.TenantID != nil && *user.TenantID != "" {
		tenantID := *user.TenantID
		result.TenantID = &tenantID
	}
	if tenant != nil {
		name := tenant.Name
		result.TenantName = &name
	}
	return result
}

func findTenantByID(store authStoreFile, tenantID string) *TenantRecord {
	for _, tenant := range store.Tenants {
		if tenant.ID == tenantID {
			copy := tenant
			return &copy
		}
	}
	return nil
}

func findUserByID(store authStoreFile, userID string) *storedUser {
	for _, user := range store.Users {
		if user.ID == userID {
			copy := user
			return &copy
		}
	}
	return nil
}

func (s *authStore) authenticate(email, password string) (*AuthUser, error) {
	store, err := s.load()
	if err != nil {
		return nil, err
	}

	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	for _, user := range store.Users {
		if user.Email != normalizedEmail || !user.Active {
			continue
		}
		if !verifyPassword(password, user.PasswordSalt, user.PasswordHash) {
			return nil, nil
		}

		tenant := (*TenantRecord)(nil)
		if user.TenantID != nil {
			tenant = findTenantByID(store, *user.TenantID)
		}
		sanitized := sanitizeUser(user, tenant)
		return &sanitized, nil
	}
	return nil, nil
}

func (s *authStore) listTenants() ([]TenantRecord, error) {
	store, err := s.load()
	if err != nil {
		return nil, err
	}
	return store.Tenants, nil
}

func (s *authStore) createTenant(name, slug string) (*TenantRecord, error) {
	store, err := s.load()
	if err != nil {
		return nil, err
	}

	tenantSlug := slugify(firstNonEmpty(slug, name))
	if strings.TrimSpace(name) == "" || tenantSlug == "" {
		return nil, errors.New("Tenant name is required")
	}
	for _, tenant := range store.Tenants {
		if tenant.Slug == tenantSlug {
			return nil, errors.New("Tenant slug already exists")
		}
	}

	tenant := TenantRecord{
		ID:        uuid.NewString(),
		Name:      strings.TrimSpace(name),
		Slug:      tenantSlug,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	store.Tenants = append(store.Tenants, tenant)
	if err := s.save(store); err != nil {
		return nil, err
	}
	return &tenant, nil
}

func (s *authStore) listUsers(tenantID *string) ([]AuthUser, error) {
	store, err := s.load()
	if err != nil {
		return nil, err
	}

	users := make([]AuthUser, 0)
	for _, user := range store.Users {
		if tenantID != nil && (user.TenantID == nil || *user.TenantID != *tenantID) {
			continue
		}
		tenant := (*TenantRecord)(nil)
		if user.TenantID != nil {
			tenant = findTenantByID(store, *user.TenantID)
		}
		users = append(users, sanitizeUser(user, tenant))
	}
	return users, nil
}

func (s *authStore) createUser(name, email, password, role string, tenantID *string) (*AuthUser, error) {
	store, err := s.load()
	if err != nil {
		return nil, err
	}

	normalizedRole := strings.ToLower(strings.TrimSpace(role))
	if normalizedRole != "super_admin" && normalizedRole != "admin" && normalizedRole != "user" {
		return nil, errors.New("Invalid role")
	}
	if normalizedRole != "super_admin" && (tenantID == nil || *tenantID == "") {
		return nil, errors.New("tenantId is required for admin and user roles")
	}
	if strings.TrimSpace(name) == "" || strings.TrimSpace(email) == "" || password == "" {
		return nil, errors.New("name, email, and password are required")
	}

	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	for _, user := range store.Users {
		if user.Email == normalizedEmail {
			return nil, errors.New("Email already exists")
		}
	}

	salt, hash, err := newPasswordHash(password)
	if err != nil {
		return nil, err
	}

	var storedTenantID *string
	if normalizedRole != "super_admin" && tenantID != nil && *tenantID != "" {
		copy := *tenantID
		storedTenantID = &copy
	}

	user := storedUser{
		ID:           uuid.NewString(),
		TenantID:     storedTenantID,
		Email:        normalizedEmail,
		Name:         strings.TrimSpace(name),
		Role:         normalizedRole,
		PasswordSalt: salt,
		PasswordHash: hash,
		Active:       true,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
	}

	store.Users = append(store.Users, user)
	if err := s.save(store); err != nil {
		return nil, err
	}

	tenant := (*TenantRecord)(nil)
	if storedTenantID != nil {
		tenant = findTenantByID(store, *storedTenantID)
	}
	sanitized := sanitizeUser(user, tenant)
	return &sanitized, nil
}

func (s *authStore) updateUser(userID string, updates map[string]any) (*AuthUser, error) {
	store, err := s.load()
	if err != nil {
		return nil, err
	}

	index := -1
	for i, user := range store.Users {
		if user.ID == userID {
			index = i
			break
		}
	}
	if index < 0 {
		return nil, errors.New("User not found")
	}

	user := store.Users[index]
	if name, ok := updates["name"].(string); ok && strings.TrimSpace(name) != "" {
		user.Name = strings.TrimSpace(name)
	}
	if active, ok := updates["active"].(bool); ok {
		user.Active = active
	}
	if role, ok := updates["role"].(string); ok && strings.TrimSpace(role) != "" {
		normalizedRole := strings.ToLower(strings.TrimSpace(role))
		if normalizedRole != "super_admin" && normalizedRole != "admin" && normalizedRole != "user" {
			return nil, errors.New("Invalid role")
		}
		user.Role = normalizedRole
	}
	if password, ok := updates["password"].(string); ok && password != "" {
		salt, hash, hashErr := newPasswordHash(password)
		if hashErr != nil {
			return nil, hashErr
		}
		user.PasswordSalt = salt
		user.PasswordHash = hash
	}
	if tenantID, exists := updates["tenantId"]; exists {
		switch value := tenantID.(type) {
		case nil:
			user.TenantID = nil
		case string:
			trimmed := strings.TrimSpace(value)
			if trimmed == "" {
				user.TenantID = nil
			} else {
				copy := trimmed
				user.TenantID = &copy
			}
		default:
			return nil, fmt.Errorf("invalid tenantId")
		}
	}

	store.Users[index] = user
	if err := s.save(store); err != nil {
		return nil, err
	}

	tenant := (*TenantRecord)(nil)
	if user.TenantID != nil {
		tenant = findTenantByID(store, *user.TenantID)
	}
	sanitized := sanitizeUser(user, tenant)
	return &sanitized, nil
}
