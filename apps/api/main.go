package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/joho/godotenv"
)

type contextKey string

const authUserKey contextKey = "authUser"

type app struct {
	authStore      *authStore
	campaignStore  *campaignStore
	calculator     *calculatorService
	optionService  *optionService
	jwtSecret      []byte
	jwtExpiry      time.Duration
	logPath        string
	uploadDir      string
	printIQBaseURL string
}

type authClaims struct {
	Role     string  `json:"role"`
	TenantID *string `json:"tenantId"`
	Email    string  `json:"email"`
	Name     string  `json:"name"`
	jwt.RegisteredClaims
}

func main() {
	loadEnvFiles()

	if len(os.Args) > 1 {
		runCLI(os.Args[1:])
		return
	}

	ctx := context.Background()
	pool, err := connectDatabase(ctx)
	if err != nil {
		log.Fatalf("database init failed: %v", err)
	}
	defer pool.Close()

	if err := runMigrations(ctx, pool); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}

	calculator, err := newCalculatorService()
	if err != nil {
		log.Fatalf("calculator init failed: %v", err)
	}

	baseDir := "."
	api := &app{
		authStore:      newAuthStore(pool),
		campaignStore:  newCampaignStore(pool),
		calculator:     calculator,
		optionService:  newOptionService(envOrDefault("PRINTIQ_BASE_URL", "https://adsaust.printiq.com"), filepath.Join(baseDir, "storage", "data")),
		jwtSecret:      []byte(envOrDefault("JWT_SECRET", "flowiq-dev-secret")),
		jwtExpiry:      parseDurationOrDefault(envOrDefault("JWT_EXPIRES_IN", "8h"), 8*time.Hour),
		logPath:        filepath.Join(baseDir, "storage", "logs", "printiq-payloads.log"),
		uploadDir:      filepath.Join(baseDir, "storage", "uploads", "purchase-orders"),
		printIQBaseURL: envOrDefault("PRINTIQ_BASE_URL", "https://adsaust.printiq.com"),
	}

	if err := os.MkdirAll(filepath.Dir(api.logPath), 0o755); err != nil {
		log.Fatalf("failed to create log directory: %v", err)
	}
	if err := os.MkdirAll(api.uploadDir, 0o755); err != nil {
		log.Fatalf("failed to create upload directory: %v", err)
	}

	address := fmt.Sprintf(":%s", envOrDefault("PORT", "4000"))
	log.Printf("FlowIQ API listening on http://localhost%s", address)
	if err := http.ListenAndServe(address, api.withCORS(api.routes())); err != nil {
		log.Fatal(err)
	}
}

func runCLI(args []string) {
	if len(args) == 0 {
		log.Fatal("missing command")
	}

	ctx := context.Background()
	pool, err := connectDatabase(ctx)
	if err != nil {
		log.Fatalf("database init failed: %v", err)
	}
	defer pool.Close()

	switch args[0] {
	case "migrate":
		if err := runMigrations(ctx, pool); err != nil {
			log.Fatalf("database migration failed: %v", err)
		}
		log.Println("Database migrations applied successfully")
	case "seed":
		if err := runMigrations(ctx, pool); err != nil {
			log.Fatalf("database migration failed: %v", err)
		}
		if err := seedDatabase(ctx, pool); err != nil {
			log.Fatalf("database seed failed: %v", err)
		}
		log.Println("Database seed completed successfully")
	default:
		log.Fatalf("unsupported command: %s", args[0])
	}
}

func loadEnvFiles() {
	_ = godotenv.Load()
	_ = godotenv.Overload(".env")
	_ = godotenv.Overload(filepath.Join("..", "..", ".env"))
	if repoRoot := resolvePrimaryRepoRoot(filepath.Join("..", "..", ".git")); repoRoot != "" {
		_ = godotenv.Overload(filepath.Join(repoRoot, ".env"))
	}
}

func resolvePrimaryRepoRoot(gitPointerPath string) string {
	content, err := os.ReadFile(gitPointerPath)
	if err != nil {
		return ""
	}

	line := strings.TrimSpace(string(content))
	if !strings.HasPrefix(strings.ToLower(line), "gitdir:") {
		return ""
	}

	gitDirValue := strings.TrimSpace(line[len("gitdir:"):])
	if gitDirValue == "" {
		return ""
	}

	if !filepath.IsAbs(gitDirValue) {
		gitDirValue = filepath.Join(filepath.Dir(gitPointerPath), gitDirValue)
	}

	gitDir := filepath.Clean(gitDirValue)
	worktreesSegment := string(filepath.Separator) + ".git" + string(filepath.Separator) + "worktrees" + string(filepath.Separator)
	if strings.Contains(gitDir, worktreesSegment) {
		return filepath.Dir(filepath.Dir(filepath.Dir(gitDir)))
	}

	if strings.EqualFold(filepath.Base(gitDir), ".git") {
		return filepath.Dir(gitDir)
	}

	return ""
}

func envOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func requiredEnv(key string) (string, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return "", fmt.Errorf("Missing required environment variable: %s", key)
	}
	return value, nil
}

func parseDurationOrDefault(value string, fallback time.Duration) time.Duration {
	duration, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return duration
}

func stringPtr(value string) *string {
	return &value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", a.handleHealth)
	mux.HandleFunc("POST /api/auth/login", a.handleLogin)
	mux.Handle("GET /api/auth/me", a.withAuth(http.HandlerFunc(a.handleCurrentSession)))
	mux.Handle("GET /api/campaigns", a.withAuth(http.HandlerFunc(a.handleListCampaigns)))
	mux.Handle("POST /api/campaigns", a.withAuth(http.HandlerFunc(a.handleCreateCampaign)))
	mux.Handle("GET /api/campaigns/{campaignId}", a.withAuth(http.HandlerFunc(a.handleGetCampaign)))
	mux.Handle("PUT /api/campaigns/{campaignId}", a.withAuth(http.HandlerFunc(a.handleUpdateCampaign)))
	mux.Handle("POST /api/campaigns/{campaignId}/calculate", a.withAuth(http.HandlerFunc(a.handleCalculatePersistedCampaign)))
	mux.Handle("POST /api/campaigns/{campaignId}/submit-to-printiq", a.withAuth(http.HandlerFunc(a.handleSubmitCampaign)))
	mux.Handle("GET /api/calculator/metadata", a.withAuth(http.HandlerFunc(a.handleCalculatorMetadata)))
	mux.Handle("POST /api/calculator/calculate", a.withAuth(http.HandlerFunc(a.handleCalculateCampaign)))
	mux.Handle("GET /api/printiq/options/quote-form", a.withAuth(http.HandlerFunc(a.handleQuoteFormOptions)))
	mux.Handle("GET /api/printiq/options/stocks", a.withAuth(http.HandlerFunc(a.handleSearchStocks)))
	mux.Handle("GET /api/printiq/options/processes", a.withAuth(http.HandlerFunc(a.handleSearchProcesses)))
	mux.Handle("GET /api/printiq/token", a.withAuth(http.HandlerFunc(a.handlePrintIQToken)))
	mux.Handle("POST /api/quotes/price", a.withAuth(http.HandlerFunc(a.handleQuotePrice)))
	mux.Handle("POST /api/purchase-orders/upload", a.withAuth(http.HandlerFunc(a.handlePurchaseOrderUpload)))
	mux.Handle("GET /api/admin/tenants", a.withAuth(a.requireRoles(http.HandlerFunc(a.handleListTenants), "super_admin")))
	mux.Handle("POST /api/admin/tenants", a.withAuth(a.requireRoles(http.HandlerFunc(a.handleCreateTenant), "super_admin")))
	mux.Handle("GET /api/admin/users", a.withAuth(a.requireRoles(http.HandlerFunc(a.handleListUsers), "super_admin", "admin")))
	mux.Handle("POST /api/admin/users", a.withAuth(a.requireRoles(http.HandlerFunc(a.handleCreateUser), "super_admin", "admin")))
	mux.Handle("PATCH /api/admin/users/{userId}", a.withAuth(a.requireRoles(http.HandlerFunc(a.handleUpdateUser), "super_admin", "admin")))
	mux.Handle("GET /api/admin/printiq-options/status", a.withAuth(a.requireRoles(http.HandlerFunc(a.handleOptionsStatus), "super_admin")))
	mux.Handle("POST /api/admin/printiq-options/refresh", a.withAuth(a.requireRoles(http.HandlerFunc(a.handleRefreshOptions), "super_admin")))

	return mux
}

func (a *app) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *app) signAuthToken(user AuthUser) (string, error) {
	claims := authClaims{
		Role:     user.Role,
		TenantID: user.TenantID,
		Email:    user.Email,
		Name:     user.Name,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(a.jwtExpiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.jwtSecret)
}

func (a *app) withAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
			return
		}

		tokenString := strings.TrimPrefix(header, "Bearer ")
		token, err := jwt.ParseWithClaims(tokenString, &authClaims{}, func(token *jwt.Token) (any, error) {
			return a.jwtSecret, nil
		})
		if err != nil || !token.Valid {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid or expired token"})
			return
		}

		claims, ok := token.Claims.(*authClaims)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid or expired token"})
			return
		}

		user, err := a.authStore.userByID(r.Context(), claims.Subject)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if user == nil || !user.Active {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Session is no longer valid"})
			return
		}

		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authUserKey, *user)))
	})
}

func (a *app) requireRoles(next http.Handler, roles ...string) http.Handler {
	allowed := map[string]bool{}
	for _, role := range roles {
		allowed[role] = true
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := currentUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
			return
		}
		if !allowed[user.Role] {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission to perform this action"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func currentUser(ctx context.Context) *AuthUser {
	authUser, ok := ctx.Value(authUserKey).(AuthUser)
	if !ok {
		return nil
	}
	return &authUser
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func decodeJSONBody(r *http.Request, target any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(target)
}

func (a *app) appendPrintIQLog(entry any) {
	bytes, err := json.Marshal(entry)
	if err != nil {
		return
	}
	file, err := os.OpenFile(a.logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.Write(append(bytes, '\n'))
}

func createRequestID() string {
	return fmt.Sprintf("%d-%d", time.Now().UnixMilli(), time.Now().UnixNano()%1_000_000)
}

func (a *app) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"printIqBaseUrl": a.printIQBaseURL,
	})
}

func (a *app) handleLogin(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	user, err := a.authStore.authenticate(payload.Email, payload.Password)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid email or password"})
		return
	}

	token, err := a.signAuthToken(*user)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

func (a *app) handleCurrentSession(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, currentUser(r.Context()))
}

func (a *app) handleCreateCampaign(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	var payload struct {
		Values orderFormValues `json:"values"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	campaign, err := a.campaignStore.createCampaign(r.Context(), *user, payload.Values)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"campaign": campaign})
}

func (a *app) handleListCampaigns(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	campaigns, err := a.campaignStore.listCampaigns(r.Context(), *user)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"campaigns": campaigns})
}

func (a *app) handleGetCampaign(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	campaign, err := a.campaignStore.getCampaign(r.Context(), *user, r.PathValue("campaignId"))
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"campaign": campaign})
}

func (a *app) handleUpdateCampaign(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	var payload struct {
		Values orderFormValues `json:"values"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	campaign, err := a.campaignStore.updateCampaign(r.Context(), *user, r.PathValue("campaignId"), payload.Values)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"campaign": campaign})
}

func (a *app) handleCalculatePersistedCampaign(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	campaign, summary, err := a.campaignStore.calculateCampaign(r.Context(), *user, r.PathValue("campaignId"), a.calculator)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"campaign": campaign, "summary": summary})
}

func (a *app) handleCalculatorMetadata(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"markets":    a.calculator.markets,
		"formatKeys": formatKeys,
	})
}

func (a *app) handleCalculateCampaign(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		CampaignLines []campaignLine `json:"campaignLines"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}
	writeJSON(w, http.StatusOK, a.calculator.calculateCampaign(payload.CampaignLines))
}

func (a *app) handleQuoteFormOptions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.optionService.getQuoteFormOptions())
}

func (a *app) handleSearchStocks(w http.ResponseWriter, r *http.Request) {
	results, err := a.optionService.searchStockDefinitions(r.URL.Query().Get("q"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (a *app) handleSearchProcesses(w http.ResponseWriter, r *http.Request) {
	results, err := a.optionService.searchProcessTypes(r.URL.Query().Get("q"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (a *app) handlePrintIQToken(w http.ResponseWriter, _ *http.Request) {
	token, err := a.optionService.getLoginToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

func (a *app) handleQuotePrice(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	requestID := createRequestID()

	var payload any
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	a.appendPrintIQLog(map[string]any{
		"requestId": requestID,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"type":      "request",
		"tenantId":  user.TenantID,
		"userId":    user.ID,
		"payload":   payload,
	})

	parsed, status, err := a.optionService.requestQuotePrice(payload)
	if err != nil {
		a.appendPrintIQLog(map[string]any{
			"requestId": requestID,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"type":      "error",
			"tenantId":  user.TenantID,
			"userId":    user.ID,
			"response":  err.Error(),
			"status":    500,
		})
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if status < 200 || status >= 300 {
		a.appendPrintIQLog(map[string]any{
			"requestId": requestID,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"type":      "error",
			"tenantId":  user.TenantID,
			"userId":    user.ID,
			"response":  parsed,
			"status":    status,
		})
		writeJSON(w, status, map[string]any{"error": "PrintIQ quote request failed", "details": parsed})
		return
	}

	if payloadMap, ok := parsed.(map[string]any); ok {
		if isError, ok := payloadMap["IsError"].(bool); ok && isError {
			message := "PrintIQ returned an error"
			if rawMessage, ok := payloadMap["ErrorMessage"].(string); ok && strings.TrimSpace(rawMessage) != "" {
				message = strings.TrimSpace(rawMessage)
			}
			a.appendPrintIQLog(map[string]any{
				"requestId": requestID,
				"timestamp": time.Now().UTC().Format(time.RFC3339),
				"type":      "error",
				"tenantId":  user.TenantID,
				"userId":    user.ID,
				"response":  parsed,
				"status":    status,
			})
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": message})
			return
		}
	}

	a.appendPrintIQLog(map[string]any{
		"requestId": requestID,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"type":      "response",
		"tenantId":  user.TenantID,
		"userId":    user.ID,
		"response":  parsed,
		"status":    status,
	})
	writeJSON(w, http.StatusOK, map[string]any{"amount": extractQuoteAmount(parsed)})
}

func (a *app) handleSubmitCampaign(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	campaign, err := a.campaignStore.getCampaign(r.Context(), *user, r.PathValue("campaignId"))
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	if campaign.Summary == nil {
		campaign, _, err = a.campaignStore.calculateCampaign(r.Context(), *user, campaign.ID, a.calculator)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}

	payload := buildPrintIQPayload(campaign.Values, campaign.Summary)
	requestID := createRequestID()
	a.appendPrintIQLog(map[string]any{
		"requestId":  requestID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"type":       "request",
		"tenantId":   campaign.TenantID,
		"userId":     user.ID,
		"campaignId": campaign.ID,
		"payload":    payload,
	})

	parsed, status, err := a.optionService.requestQuotePrice(payload)
	if err != nil {
		a.appendPrintIQLog(map[string]any{
			"requestId":  requestID,
			"timestamp":  time.Now().UTC().Format(time.RFC3339),
			"type":       "error",
			"tenantId":   campaign.TenantID,
			"userId":     user.ID,
			"campaignId": campaign.ID,
			"response":   err.Error(),
			"status":     500,
		})
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if status < 200 || status >= 300 {
		a.appendPrintIQLog(map[string]any{
			"requestId":  requestID,
			"timestamp":  time.Now().UTC().Format(time.RFC3339),
			"type":       "error",
			"tenantId":   campaign.TenantID,
			"userId":     user.ID,
			"campaignId": campaign.ID,
			"response":   parsed,
			"status":     status,
		})
		writeJSON(w, status, map[string]any{"error": "PrintIQ quote request failed", "details": parsed})
		return
	}
	if payloadMap, ok := parsed.(map[string]any); ok {
		if isError, ok := payloadMap["IsError"].(bool); ok && isError {
			message := "PrintIQ returned an error"
			if rawMessage, ok := payloadMap["ErrorMessage"].(string); ok && strings.TrimSpace(rawMessage) != "" {
				message = strings.TrimSpace(rawMessage)
			}
			a.appendPrintIQLog(map[string]any{
				"requestId":  requestID,
				"timestamp":  time.Now().UTC().Format(time.RFC3339),
				"type":       "error",
				"tenantId":   campaign.TenantID,
				"userId":     user.ID,
				"campaignId": campaign.ID,
				"response":   parsed,
				"status":     status,
			})
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": message})
			return
		}
	}

	a.appendPrintIQLog(map[string]any{
		"requestId":  requestID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"type":       "response",
		"tenantId":   campaign.TenantID,
		"userId":     user.ID,
		"campaignId": campaign.ID,
		"response":   parsed,
		"status":     status,
	})

	amount := extractQuoteAmount(parsed)
	updatedCampaign, err := a.campaignStore.recordSubmission(r.Context(), *user, campaign.ID, payload, parsed, amount)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"campaign": updatedCampaign, "amount": amount})
}

var unsafeFilenamePattern = regexp.MustCompile(`[^a-zA-Z0-9-_]`)

func (a *app) handlePurchaseOrderUpload(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	if err := r.ParseMultipartForm(25 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No file uploaded"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "No file uploaded"})
		return
	}
	defer file.Close()

	extension := filepath.Ext(header.Filename)
	baseName := strings.TrimSuffix(header.Filename, extension)
	safeBaseName := unsafeFilenamePattern.ReplaceAllString(baseName, "_")
	safeBaseName = strings.TrimSpace(safeBaseName)
	if safeBaseName == "" {
		safeBaseName = "purchase-order"
	}
	if len(safeBaseName) > 64 {
		safeBaseName = safeBaseName[:64]
	}

	storedName := fmt.Sprintf("%d-%s%s", time.Now().UnixMilli(), safeBaseName, extension)
	targetPath := filepath.Join(a.uploadDir, storedName)
	out, err := os.Create(targetPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer out.Close()

	size, err := io.Copy(out, file)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	response := uploadResponse{
		OriginalName: header.Filename,
		StoredName:   storedName,
		Size:         size,
		MimeType:     header.Header.Get("Content-Type"),
		UploadedAt:   time.Now().UTC().Format(time.RFC3339),
	}

	if campaignID := strings.TrimSpace(r.FormValue("campaignId")); campaignID != "" && user != nil {
		if _, err := a.campaignStore.setPurchaseOrder(r.Context(), *user, campaignID, response); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}

	writeJSON(w, http.StatusCreated, response)
}

func (a *app) handleListTenants(w http.ResponseWriter, _ *http.Request) {
	tenants, err := a.authStore.listTenants()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tenants": tenants})
}

func (a *app) handleCreateTenant(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	tenant, err := a.authStore.createTenant(payload.Name, payload.Slug)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"tenant": tenant})
}

func canManageTargetTenant(user *AuthUser, targetTenantID *string) bool {
	if user == nil {
		return false
	}
	if user.Role == "super_admin" {
		return true
	}
	if user.TenantID == nil || targetTenantID == nil {
		return false
	}
	return *user.TenantID == *targetTenantID
}

func (a *app) handleListUsers(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	var tenantID *string
	if user.Role == "super_admin" {
		if raw := strings.TrimSpace(r.URL.Query().Get("tenantId")); raw != "" {
			tenantID = &raw
		}
	} else {
		tenantID = user.TenantID
	}

	users, err := a.authStore.listUsers(tenantID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (a *app) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	var payload struct {
		Name     string  `json:"name"`
		Email    string  `json:"email"`
		Password string  `json:"password"`
		Role     string  `json:"role"`
		TenantID *string `json:"tenantId"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	targetTenantID := payload.TenantID
	if user.Role != "super_admin" {
		targetTenantID = user.TenantID
	}
	if !canManageTargetTenant(user, targetTenantID) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "You cannot create users for another tenant"})
		return
	}
	if user.Role != "super_admin" && payload.Role == "super_admin" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Only a super admin can create a super admin user"})
		return
	}

	createdUser, err := a.authStore.createUser(payload.Name, payload.Email, payload.Password, payload.Role, targetTenantID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": createdUser})
}

func (a *app) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	user := currentUser(r.Context())
	var payload map[string]any
	if err := decodeJSONBody(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if role, ok := payload["role"].(string); ok && user.Role != "super_admin" && role == "super_admin" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Only a super admin can assign the super_admin role"})
		return
	}
	if user.Role != "super_admin" {
		payload["tenantId"] = user.TenantID
	}

	updatedUser, err := a.authStore.updateUser(r.PathValue("userId"), payload)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if user.Role != "super_admin" {
		if user.TenantID == nil || updatedUser.TenantID == nil || *updatedUser.TenantID != *user.TenantID {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You cannot move users to another tenant"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": updatedUser})
}

func (a *app) handleOptionsStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.optionService.getOptionsCacheStatus())
}

func (a *app) handleRefreshOptions(w http.ResponseWriter, _ *http.Request) {
	stocks, processes, err := a.optionService.refreshOptionsCache()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"message":   "PrintIQ option cache refreshed successfully",
		"stocks":    stocks,
		"processes": processes,
	})
}
