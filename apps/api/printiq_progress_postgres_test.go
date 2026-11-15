package main

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPrintIQProgressPostgres(t *testing.T) {
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
	schema := "printiq_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = base.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
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
	migrations, err := loadMigrationFiles("db/migrations")
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range migrations {
		sql, err := os.ReadFile(migration.Path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("%s: %v", migration.Name, err)
		}
	}
	auth := newAuthStore(pool)
	tenant, err := auth.createTenant("Test", "TEST")
	if err != nil {
		t.Fatal(err)
	}
	user, err := auth.createUser("Creator", "creator@example.test", "test-password", "admin", &tenant.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Run("test mode compatibility", func(t *testing.T) { testPrintIQTestModeCompatibility(t, pool, *tenant, *user) })
	store := &campaignStore{pool: pool}
	campaign, err := store.createCampaign(ctx, *user, orderFormValues{CampaignName: "Test"})
	if err != nil {
		t.Fatal(err)
	}
	a := &app{campaignStore: store}
	journal := &printIQJournal{Creator: "Creator", Plans: []printIQMarketPlan{{Market: "Sydney"}}}
	if err = a.createPrintIQJournal(ctx, campaign, journal); err != nil {
		t.Fatal(err)
	}
	if err := a.bindPrintIQJournal(ctx, journal); err != nil {
		t.Fatal(err)
	}
	if _, failure := journal.run("Sydney:0", "CreateQuoteWithDelivery", map[string]any{}, func() (any, *printIQSubmissionFailure) { return map[string]any{"QuoteNo": "Q1"}, nil }); failure != nil {
		t.Fatal(failure)
	}
	restored, err := a.loadPrintIQJournal(ctx, campaign)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Steps["Sydney:0"].State != "done" || restored.Plans[0].Values.CreatedByDisplayName != "Creator" {
		t.Fatal("checkpoint did not survive reload")
	}
	journal.Steps["Sydney:1"] = &printIQSavedStep{Name: "UploadArtworkURL", State: "pending", Payload: `{"JobNo":"J1"}`}
	if err := journal.save(); err != nil {
		t.Fatal(err)
	}
	// Progress is visible to normal campaign users but exposes no recovery payloads.
	for _, foreignTenant := range []bool{false, true} {
		actor := *user
		if foreignTenant {
			other := uuid.NewString()
			actor.TenantID = &other
		}
		r := httptest.NewRequest("GET", "/", nil)
		r.SetPathValue("campaignId", campaign.ID)
		r = r.WithContext(context.WithValue(r.Context(), authUserKey, actor))
		w := httptest.NewRecorder()
		a.handleSubmissionProgress(w, r)
		if foreignTenant {
			if w.Code != 404 {
				t.Fatalf("cross-tenant progress exposed: %d", w.Code)
			}
		} else if w.Code != 200 || strings.Contains(w.Body.String(), "Q1") || strings.Contains(w.Body.String(), "J1") || strings.Contains(w.Body.String(), "Payload") || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("unsafe progress response: %d %s", w.Code, w.Body.String())
		}
	}
	resolve := func(role, tenantID string) int {
		actor := *user
		actor.Role = role
		body := fmt.Sprintf(`{"submissionId":%q,"stepKey":"Sydney:1","action":"confirmed_uploaded","confirmedInPrintIQ":true,"note":"Checked exact PDF on J1"}`, journal.ID)
		r := httptest.NewRequest("POST", "/?tenantId="+tenantID, strings.NewReader(body))
		r.SetPathValue("campaignId", campaign.ID)
		r = r.WithContext(context.WithValue(r.Context(), authUserKey, actor))
		w := httptest.NewRecorder()
		a.handlePrintIQProgress(w, r)
		return w.Code
	}
	if code := resolve("admin", tenant.ID); code != 403 {
		t.Fatalf("admin reconciled upload: %d", code)
	}
	if code := resolve("super_admin", uuid.NewString()); code != 404 {
		t.Fatalf("cross-tenant resolution: %d", code)
	}
	lock, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lock.Exec(ctx, "SELECT pg_advisory_lock(hashtextextended($1,0))", "printiq:"+campaign.ID); err != nil {
		t.Fatal(err)
	}
	if code := resolve("super_admin", tenant.ID); code != 409 {
		t.Fatalf("resolved during submission: %d", code)
	}
	if _, err := lock.Exec(ctx, "SELECT pg_advisory_unlock(hashtextextended($1,0))", "printiq:"+campaign.ID); err != nil {
		t.Fatal(err)
	}
	lock.Release()
	if code := resolve("super_admin", tenant.ID); code != 200 {
		t.Fatalf("resolution failed: %d", code)
	}
	reconciled, err := a.loadPrintIQJournal(ctx, campaign)
	if err != nil || reconciled.Steps["Sydney:1"].State != "done" || len(reconciled.Resolutions) != 1 {
		t.Fatal("resolution not durable", err)
	}
	checkpoint := printIQRecordCheckpoint{ID: journal.ID, Market: "Sydney"}
	for i := 0; i < 2; i++ {
		if _, err = store.recordSubmission(ctx, *user, campaign.ID, map[string]any{}, map[string]any{}, nil, []string{"J1"}, false, checkpoint); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM quotes WHERE campaign_id=$1", campaign.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate quote: %d %v", count, err)
	}
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE campaign_id=$1", campaign.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate job: %d %v", count, err)
	}
	checkpoint.Market = "Melbourne"
	checkpoint.Final = true
	a.logDir = t.TempDir()
	logRow := fmt.Sprintf(`{"campaignId":%q,"tenantId":%q,"requestId":"reconciled","timestamp":"2026-09-22T14:06:14Z","type":"error"}`, campaign.ID, campaign.TenantID)
	if err := os.WriteFile(filepath.Join(a.logDir, printIQLogPrefix+"2026-09-22"+printIQLogSuffix), []byte(logRow+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.checkPrintIQHistory(ctx, campaign); err == nil {
		t.Fatal("historical failure ignored without completed checkpoint")
	}
	if _, err = store.recordSubmission(ctx, *user, campaign.ID, map[string]any{}, map[string]any{}, nil, []string{"J2"}, true, checkpoint); err != nil {
		t.Fatal(err)
	}
	if err := a.checkPrintIQHistory(ctx, campaign); err != nil {
		t.Fatal("reconciled log error blocked completed submission", err)
	}
	if active, err := a.loadPrintIQJournal(ctx, campaign); err != nil || active != nil {
		t.Fatal("completed checkpoint still active", err)
	}
	updated, err := store.getCampaign(ctx, *user, campaign.ID)
	if err != nil || updated.Status != "submitted" {
		t.Fatal("campaign not submitted", err)
	}
	// Exercise the real submit entry point after completion, including super
	// admin. A nil optionService ensures no PrintIQ call can slip through.
	completedCampaign, err := store.createCampaign(ctx, *user, orderFormValues{CampaignName: "Completed"})
	if err != nil {
		t.Fatal(err)
	}
	completedJournal := &printIQJournal{Plans: []printIQMarketPlan{{Market: "Sydney", Products: []printIQSheetProduct{{}}}}}
	if err := a.createPrintIQJournal(ctx, completedCampaign, completedJournal); err != nil {
		t.Fatal(err)
	}
	if err := a.bindPrintIQJournal(ctx, completedJournal); err != nil {
		t.Fatal(err)
	}
	completedJournal.Steps["Sydney:0"] = &printIQSavedStep{Name: "CreateQuoteWithDelivery", State: "done", Response: map[string]any{"QuoteDetails": map[string]any{"QuoteNo": "Qdone", "Products": []any{map[string]any{"ProductKey": 1, "QQDKey": 1}}}}}
	completedJournal.Steps["Sydney:3"] = &printIQSavedStep{Name: "AcceptQuote", State: "pending", Payload: `{"QuoteNo":"Qdone"}`}
	if err := completedJournal.save(); err != nil {
		t.Fatal(err)
	}
	// The general reconciliation endpoint restores an existing job response.
	actor := *user
	actor.Role = "super_admin"
	body := fmt.Sprintf(`{"submissionId":%q,"stepKey":"Sydney:3","action":"confirmed_completed","confirmedInPrintIQ":true,"note":"Verified Qdone and Jdone in PrintIQ","response":{"AcceptanceDetails":{"QuoteNo":"Qdone","Products":[{"ProductKey":1,"QuantityKey":1,"JobNo":"Jdone"}]}}}`, completedJournal.ID)
	r := httptest.NewRequest("POST", "/printiq-progress/resolve-step?tenantId="+tenant.ID, strings.NewReader(body))
	r.SetPathValue("campaignId", completedCampaign.ID)
	r = r.WithContext(context.WithValue(ctx, authUserKey, actor))
	w := httptest.NewRecorder()
	a.handlePrintIQProgress(w, r)
	if w.Code != 200 {
		t.Fatalf("general reconciliation failed: %s", w.Body.String())
	}
	if _, err := store.recordSubmission(ctx, *user, completedCampaign.ID, map[string]any{}, map[string]any{}, nil, []string{"Jdone"}, true, printIQRecordCheckpoint{ID: completedJournal.ID, Market: "Sydney", Final: true}); err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"admin", "super_admin"} {
		actor.Role = role
		r := httptest.NewRequest("POST", "/submit-to-printiq?tenantId="+tenant.ID, nil)
		r.SetPathValue("campaignId", completedCampaign.ID)
		r = r.WithContext(context.WithValue(ctx, authUserKey, actor))
		w := httptest.NewRecorder()
		a.handleSubmitCampaign(w, r)
		if w.Code != 200 || !strings.Contains(w.Body.String(), "Qdone") || !strings.Contains(w.Body.String(), "Jdone") {
			t.Fatalf("%s repeated submission failed: %d %s", role, w.Code, w.Body.String())
		}
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM quotes WHERE campaign_id=$1", completedCampaign.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("repeated Submit duplicated local quote: %d %v", count, err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE campaign_id=$1", completedCampaign.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("repeated Submit duplicated local job: %d %v", count, err)
	}
	latest, err := a.loadLatestPrintIQJournal(ctx, completedCampaign)
	if err != nil || latest == nil || !latest.Completed || latest.progressSummary().Status != "completed" {
		t.Fatal("completed journal was not retained", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE campaigns SET form_data=jsonb_set(form_data,'{campaignName}','"Changed"'::jsonb) WHERE id=$1`, completedCampaign.ID); err != nil {
		t.Fatal(err)
	}
	r = httptest.NewRequest("POST", "/submit-to-printiq?tenantId="+tenant.ID, nil)
	r.SetPathValue("campaignId", completedCampaign.ID)
	r = r.WithContext(context.WithValue(ctx, authUserKey, actor))
	w = httptest.NewRecorder()
	a.handleSubmitCampaign(w, r)
	if w.Code != 409 || !strings.Contains(w.Body.String(), "inputs changed") {
		t.Fatalf("old result reported success for revised inputs: %d %s", w.Code, w.Body.String())
	}
	// Simulate losing the advisory-lock connection during a request. A new
	// owner must preserve fresh checkpoints and fence all writes by the old one.
	fencedCampaign, err := store.createCampaign(ctx, *user, orderFormValues{CampaignName: "Fencing"})
	if err != nil {
		t.Fatal(err)
	}
	firstRunner := &printIQJournal{}
	if err := a.createPrintIQJournal(ctx, fencedCampaign, firstRunner); err != nil {
		t.Fatal(err)
	}
	if err := a.bindPrintIQJournal(ctx, firstRunner); err != nil {
		t.Fatal(err)
	}
	secondRunner, err := a.loadPrintIQJournal(ctx, fencedCampaign)
	if err != nil {
		t.Fatal(err)
	}
	if _, failure := firstRunner.run("Sydney:0", "CreateQuoteWithDelivery", map[string]any{}, func() (any, *printIQSubmissionFailure) { return map[string]any{"QuoteNo": "Qfenced"}, nil }); failure != nil {
		t.Fatal(failure)
	}
	if err := a.bindPrintIQJournal(ctx, secondRunner); err != nil {
		t.Fatal(err)
	}
	if secondRunner.Steps["Sydney:0"].State != "done" {
		t.Fatal("claim discarded the previous runner's latest checkpoint")
	}
	if _, failure := firstRunner.run("Sydney:1", "GetPrice", map[string]any{}, func() (any, *printIQSubmissionFailure) {
		t.Fatal("old runner sent a mutation after losing ownership")
		return nil, nil
	}); failure == nil {
		t.Fatal("old runner retained write access")
	}
	if _, failure := secondRunner.run("Sydney:0", "CreateQuoteWithDelivery", map[string]any{}, func() (any, *printIQSubmissionFailure) {
		t.Fatal("new runner repeated quote creation")
		return nil, nil
	}); failure != nil {
		t.Fatal(failure)
	}
	// Reconciliation must also revoke a runner whose HTTP request is still
	// returning after its advisory-lock connection has disappeared.
	_, failure := secondRunner.run("Sydney:1", "GetPrice", map[string]any{"QuoteNo": "Qfenced"}, func() (any, *printIQSubmissionFailure) {
		actor.Role = "super_admin"
		body := fmt.Sprintf(`{"submissionId":%q,"stepKey":"Sydney:1","action":"confirmed_completed","confirmedInPrintIQ":true,"note":"Verified the product in Qfenced","response":{"ProductKey":2,"QuoteDetails":{"QuoteNo":"Qfenced","Products":[{"ProductKey":2,"QQDKey":2}]}}}`, secondRunner.ID)
		r := httptest.NewRequest("POST", "/printiq-progress/resolve-step?tenantId="+tenant.ID, strings.NewReader(body))
		r.SetPathValue("campaignId", fencedCampaign.ID)
		r = r.WithContext(context.WithValue(ctx, authUserKey, actor))
		w := httptest.NewRecorder()
		a.handlePrintIQProgress(w, r)
		if w.Code != 200 {
			t.Fatalf("reconciliation failed: %s", w.Body.String())
		}
		return map[string]any{"ProductKey": 999}, nil
	})
	if failure == nil || failure.Body["stopSubmission"] != true {
		t.Fatal("reconciled runner retained checkpoint write access")
	}
	verified, err := a.loadPrintIQJournal(ctx, fencedCampaign)
	if err != nil || printIQStringValue(valueAtPath(verified.Steps["Sydney:1"].Response, "ProductKey")) != "2" {
		t.Fatal("stale response overwrote the verified result", err)
	}
}
