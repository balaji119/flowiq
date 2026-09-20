package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Opt-in integration suite. Uses a disposable schema, never the application's configured DB.
func TestOrdersPostgres(t *testing.T) {
	databaseURL := os.Getenv("FLOWIQ_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("FLOWIQ_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	base, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	schema := "orders_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := base.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := base.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	}()
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	files, err := loadMigrationFiles("db/migrations")
	if err != nil {
		t.Fatal(err)
	}
	legacyID := uuid.NewString()
	for _, file := range files {
		if file.Name == "041_type_b_orders.sql" {
			if _, err := pool.Exec(ctx, "INSERT INTO tenants(id,tenant_id,name,code) VALUES($1,$1,'Legacy','LEGACY')", legacyID); err != nil {
				t.Fatal(err)
			}
		}
		sql, err := os.ReadFile(file.Path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("%s: %v", file.Name, err)
		}
	}
	store := newAuthStore(pool)
	legacy, err := store.getTenant(legacyID)
	if err != nil || legacy.Type != "A" {
		t.Fatalf("existing tenant changed: %v %v", legacy, err)
	}
	tenantA, err := store.createTenant("Type A", "A")
	if err != nil || tenantA.Type != "A" {
		t.Fatalf("legacy default: %v", err)
	}
	tenantB, err := store.createTenant("Type B", "B", "B")
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.createTenant("Other B", "OTHER", "B")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := store.updateTenant(tenantB.ID, "Type B renamed", "B")
	if err != nil || updated.Type != "B" {
		t.Fatalf("update changed tenant type: %v", err)
	}
	tenants, err := store.listTenants()
	if err != nil || len(tenants) != 4 {
		t.Fatalf("list tenants: %v", err)
	}
	api := &app{authStore: store, jwtSecret: []byte("test-only-key"), jwtExpiry: time.Hour, campaignImageDir: t.TempDir()}
	roles := map[string]*AuthUser{}
	for _, role := range []string{"super_admin", "admin", "user"} {
		user, err := store.createUser(role, role+"@example.test", "qa-only-password", role, &tenantB.ID)
		if err != nil {
			t.Fatal(err)
		}
		roles[role] = user
	}
	typeAUser, err := store.createUser("A user", "a@example.test", "qa-only-password", "user", &tenantA.ID)
	if err != nil {
		t.Fatal(err)
	}
	request := func(user *AuthUser, method, path string, payload any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(payload)
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		token, err := api.signAuthToken(*user)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		api.routes().ServeHTTP(response, req)
		return response
	}
	productID := uuid.NewString()
	product := map[string]string{"id": productID, "name": "Banner", "code": "BANNER"}
	path := "/api/orders/products?tenantId=" + tenantB.ID
	for _, role := range []string{"admin", "user"} {
		if response := request(roles[role], http.MethodPut, path, product); response.Code != 403 {
			t.Fatalf("%s could manage products: %s", role, response.Body)
		}
	}
	if response := request(roles["super_admin"], http.MethodPut, path, product); response.Code != 200 {
		t.Fatal(response.Body)
	}
	if response := request(typeAUser, http.MethodGet, path, nil); response.Code != 403 {
		t.Fatalf("Type A accessed orders: %s", response.Body)
	}
	if response := request(roles["user"], http.MethodGet, path, nil); response.Code != 200 || strings.Contains(response.Body.String(), "BANNER") {
		t.Fatalf("dropdown failed or exposed code: %s", response.Body)
	}
	if response := request(roles["super_admin"], http.MethodPut, "/api/orders/products?tenantId="+other.ID, product); response.Code != 403 {
		t.Fatalf("cross-tenant overwrite accepted: %s", response.Body)
	}
	address := orderAddress{ID: uuid.NewString(), Name: "Warehouse", Address: "Warehouse\n1 Road\nSydney NSW 2000\nAustralia"}
	if response := request(roles["user"], http.MethodPut, "/api/orders/addresses", address); response.Code != 403 {
		t.Fatalf("user could edit addresses: %s", response.Body)
	}
	if response := request(roles["admin"], http.MethodPut, "/api/orders/addresses", address); response.Code != 200 {
		t.Fatal(response.Body)
	}
	t.Setenv("APP_BASE_URL", "https://example.test")
	order := orderFixture()
	order.QuoteNo = "UNTRUSTED"
	order.JobNos = []string{"UNTRUSTED"}
	order.Lines = order.Lines[:1]
	order.Lines[0].ProductID = productID
	order.Lines[0].AddressID = address.ID
	if _, err := pool.Exec(ctx, "INSERT INTO order_artworks(stored_name,tenant_id,original_name,created_by) VALUES('first.pdf',$1,'art.pdf',$2)", other.ID, roles["user"].ID); err != nil {
		t.Fatal(err)
	}
	if response := request(roles["user"], http.MethodPost, "/api/orders", order); response.Code != 400 {
		t.Fatalf("foreign artwork accepted: %s", response.Body)
	}
	if _, err := pool.Exec(ctx, "UPDATE order_artworks SET tenant_id=$1", tenantB.ID); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(api.campaignImageDir+"/first.pdf", []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; http.Error(w, "unavailable", 502) }))
	defer mock.Close()
	api.optionService = newOptionService(mock.URL, t.TempDir())
	api.optionService.setCachedLoginToken("test")
	if response := request(roles["user"], http.MethodPost, "/api/orders", order); response.Code != 201 || !strings.Contains(response.Body.String(), "attention") || strings.Contains(response.Body.String(), "UNTRUSTED") {
		t.Fatalf("failed order not persisted: %d %s", response.Code, response.Body)
	}
	if response := request(roles["user"], http.MethodPost, "/api/orders", order); response.Code != 409 || calls != 1 {
		t.Fatalf("duplicate submission: %d %s calls=%d", response.Code, response.Body, calls)
	}
	if response := request(roles["super_admin"], http.MethodGet, "/api/orders?tenantId="+other.ID, nil); response.Code != 200 || strings.Contains(response.Body.String(), order.ID) {
		t.Fatalf("cross-tenant order leak: %s", response.Body)
	}
	if response := request(roles["user"], http.MethodGet, "/api/orders?tenantId="+other.ID, nil); response.Code != 200 || !strings.Contains(response.Body.String(), order.ID) {
		t.Fatalf("user escaped assigned tenant: %s", response.Body)
	}

	// Drafts persist without artworks, public artwork URLs, or PrintIQ calls.
	t.Setenv("APP_BASE_URL", "")
	draft := simpleOrder{ID: uuid.NewString(), Description: "Finish this later"}
	saveDraft := func(input simpleOrder) simpleOrder {
		response := request(roles["user"], http.MethodPut, "/api/orders/drafts", input)
		if response.Code != 200 {
			t.Fatalf("save draft: %d %s", response.Code, response.Body)
		}
		var body struct {
			Order simpleOrder `json:"order"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body.Order
	}
	draft = saveDraft(draft)
	if draft.Status != "draft" || draft.Name != "Untitled order" || draft.Revision != 1 || calls != 1 {
		t.Fatalf("unexpected draft state: %#v calls=%d", draft, calls)
	}
	if response := request(roles["user"], http.MethodPost, "/api/orders", draft); response.Code != 400 || calls != 1 {
		t.Fatalf("incomplete draft submitted: %d %s", response.Code, response.Body)
	}
	if response := request(roles["super_admin"], http.MethodPut, "/api/orders/drafts?tenantId="+other.ID, draft); response.Code != 409 {
		t.Fatalf("cross-tenant draft overwrite: %d %s", response.Code, response.Body)
	}
	staleDraft := draft
	draft.Name = "Saved artwork order"
	draft.Lines = order.Lines
	draft = saveDraft(draft)
	if draft.Revision != 2 || len(draft.Lines) != 1 || draft.Lines[0].ProductCode != "BANNER" || calls != 1 {
		t.Fatalf("draft details lost or PrintIQ called: %#v", draft)
	}
	if response := request(roles["user"], http.MethodPut, "/api/orders/drafts", staleDraft); response.Code != 409 {
		t.Fatalf("stale draft overwrote new changes: %s", response.Body)
	}
	if response := request(roles["user"], http.MethodGet, "/api/orders", nil); response.Code != 200 || !strings.Contains(response.Body.String(), "Saved artwork order") {
		t.Fatalf("draft not available to resume: %s", response.Body)
	}
	t.Setenv("APP_BASE_URL", "https://example.test")
	successCalls := 0
	successMock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		successCalls++
		var result any = map[string]any{"IsError": false}
		switch strings.TrimPrefix(r.URL.Path, "/api/QuoteProcess/") {
		case "CreateQuoteWithDelivery":
			result = map[string]any{"QuoteNo": "QDRAFT", "QQDKey": "quantity"}
		case "GetQuoteQuestions":
			result = map[string]any{"QQDPKey": "proof"}
		case "AcceptQuote":
			result = map[string]any{"AcceptanceDetails": map[string]any{"Products": []any{map[string]any{"JobNo": "JDRAFT"}}}}
		}
		_ = json.NewEncoder(w).Encode(result)
	}))
	defer successMock.Close()
	api.optionService = newOptionService(successMock.URL, t.TempDir())
	api.optionService.setCachedLoginToken("test")
	response := request(roles["user"], http.MethodPost, "/api/orders", draft)
	if response.Code != 201 || !strings.Contains(response.Body.String(), `"status":"submitted"`) || successCalls != 5 {
		t.Fatalf("draft submission failed: %d %s calls=%d", response.Code, response.Body, successCalls)
	}
	for _, method := range []string{http.MethodPut, http.MethodPost} {
		path := "/api/orders"
		if method == http.MethodPut {
			path += "/drafts"
		}
		response := request(roles["user"], method, path, draft)
		if response.Code != 409 || successCalls != 5 {
			t.Fatalf("submitted draft modified/repeated: %d %s", response.Code, response.Body)
		}
	}
	if response := request(typeAUser, http.MethodPut, "/api/orders/drafts", simpleOrder{ID: uuid.NewString()}); response.Code != 403 {
		t.Fatalf("Type A draft route permitted: %s", response.Body)
	}
}
