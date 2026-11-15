package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func testPrintIQTestModeCompatibility(t *testing.T, pool *pgxpool.Pool, tenant TenantRecord, user AuthUser) {
	ctx := context.Background()
	quotes := map[string]int{}
	creates := 0
	var interruptNormal context.CancelFunc
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			return
		}
		var input map[string]any
		_ = json.NewDecoder(r.Body).Decode(&input)
		step := strings.TrimPrefix(r.URL.Path, "/api/QuoteProcess/")
		quote := printIQStringValue(input["QuoteNo"])
		var response any = map[string]any{"IsError": false}
		switch step {
		case "CreateQuoteWithDelivery":
			creates++
			quote = fmt.Sprintf("Qmode%d", creates)
			quotes[quote] = 1
			response = map[string]any{"QuoteNo": quote, "QQDKey": quote + "-1"}
		case "GetPrice":
			quotes[quote]++
			response = map[string]any{"ProductKey": quotes[quote], "QuoteDetails": map[string]any{"Products": []any{map[string]any{"ProductKey": quotes[quote], "QQDKey": quote + "-2"}}}}
		case "GetQuoteQuestions":
			if interruptNormal != nil {
				interruptNormal()
				interruptNormal = nil
				response = map[string]any{"IsError": true, "ErrorMessage": "Rejected"}
			} else {
				response = map[string]any{"QQDPKey": input["QQDKey"]}
			}
		case "AcceptQuote":
			jobs := []any{}
			for index := 1; index <= quotes[quote]; index++ {
				jobs = append(jobs, map[string]any{"JobNo": fmt.Sprintf("%s-J%d", quote, index)})
			}
			response = map[string]any{"AcceptanceDetails": map[string]any{"Products": jobs}}
		case "SaveQuoteQuestions", "UploadArtworkURL":
		default:
			t.Errorf("unexpected PrintIQ call %s", step)
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	t.Setenv("APP_BASE_URL", server.URL)
	service := newOptionService(server.URL, t.TempDir())
	service.setCachedLoginToken("test")
	store := &campaignStore{pool: pool}
	mappings := newMappingStore(pool)
	if _, err := mappings.upsertSheetNameOverrides(ctx, tenant.ID, defaultSheetNameOverrides(), nil, nil, nil, sheetNameOverrides{"8-sheet": "PRINT"}); err != nil {
		t.Fatal(err)
	}
	a := &app{campaignStore: store, authStore: newAuthStore(pool), mappingStore: mappings, optionService: service, logDir: t.TempDir(), campaignImageDir: t.TempDir()}
	user.Role = "super_admin"
	newCampaign := func() *campaignRecord {
		values := orderFormValues{CampaignName: "Mode test", PurchaseOrderNumber: "PO1", CampaignMarkets: []campaignMarket{{Market: "Sydney", DueDate: "2026-12-01", Assets: []campaignAsset{{ID: "asset", CreativeImageID: "art"}}}}, PrintImages: []campaignPrintImage{{ID: "art", ImageURL: server.URL + "/art.pdf"}}}
		values.CreativeNameAssignments = map[string]string{"Creative1": "art"}
		campaign, err := store.createCampaign(ctx, user, values)
		if err != nil {
			t.Fatal(err)
		}
		summary, _ := json.Marshal(campaignSummary{Lines: []campaignLineResult{{ID: "asset", Market: "Sydney", Breakdown: quantityBreakdown{"8-sheet": 8}}}, PerMarket: []campaignTotals{{Market: "Sydney", Breakdown: quantityBreakdown{"8-sheet": 8}}}})
		if _, err := pool.Exec(ctx, `UPDATE campaigns SET calculation_summary=$2::jsonb, purchase_order='{"originalName":"PO.pdf"}'::jsonb WHERE id=$1`, campaign.ID, summary); err != nil {
			t.Fatal(err)
		}
		campaign, err = store.getCampaign(ctx, user, campaign.ID)
		if err != nil {
			t.Fatal(err)
		}
		return campaign
	}
	submit := func(campaign *campaignRecord, test bool, requestContext context.Context) *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		file, _ := writer.CreateFormFile("visuals", "Visuals.pdf")
		_, _ = file.Write([]byte("%PDF-1.4\n%%EOF"))
		_ = writer.Close()
		r := httptest.NewRequest("POST", fmt.Sprintf("/submit-to-printiq?tenantId=%s&test=%t", tenant.ID, test), &body)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		r.SetPathValue("campaignId", campaign.ID)
		r = r.WithContext(context.WithValue(requestContext, authUserKey, user))
		w := httptest.NewRecorder()
		a.handleSubmitCampaign(w, r)
		return w
	}
	quoteFrom := func(w *httptest.ResponseRecorder) string {
		if w.Code != 200 {
			t.Fatalf("submit failed: %d %s", w.Code, w.Body.String())
		}
		var result struct {
			QuoteNo string `json:"quoteNo"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.QuoteNo
	}
	campaign := newCampaign()
	firstTest := quoteFrom(submit(campaign, true, ctx))
	secondTest := quoteFrom(submit(campaign, true, ctx))
	if firstTest == secondTest {
		t.Fatal("repeated successful Test reused the previous quote")
	}
	normal := quoteFrom(submit(campaign, false, ctx))
	if normal == secondTest {
		t.Fatal("normal submission reused the test quote")
	}
	thirdTest := quoteFrom(submit(campaign, true, ctx))
	if thirdTest == normal {
		t.Fatal("Test after normal submission reused its quote")
	}
	before := creates
	if quoteFrom(submit(campaign, false, ctx)) != normal || creates != before {
		t.Fatal("intervening Test lost normal duplicate protection")
	}

	campaign = newCampaign()
	interrupted, cancel := context.WithCancel(ctx)
	interruptNormal = cancel
	w := submit(campaign, false, interrupted)
	if w.Code == 200 {
		t.Fatal("expected interrupted normal submission")
	}
	normalJournal, err := a.loadPrintIQJournal(ctx, campaign)
	if err != nil || normalJournal == nil {
		t.Fatal("normal checkpoint missing", err)
	}
	quote := extractQuoteNo(normalJournal.Steps["Sydney:0"].Response)
	quoteFrom(submit(campaign, true, ctx))
	before = creates
	if quoteFrom(submit(campaign, false, ctx)) != quote || creates != before {
		t.Fatal("Test discarded an unfinished normal quote")
	}

	campaign = newCampaign()
	interrupted, cancel = context.WithCancel(ctx)
	interruptNormal = cancel
	if w := submit(campaign, true, interrupted); w.Code == 200 {
		t.Fatal("expected interrupted test submission")
	}
	testJournal, err := a.loadPrintIQJournal(ctx, campaign, true)
	if err != nil || testJournal == nil {
		t.Fatal("test checkpoint missing", err)
	}
	testQuote := extractQuoteNo(testJournal.Steps["Sydney:0"].Response)
	if quoteFrom(submit(campaign, false, ctx)) == testQuote {
		t.Fatal("normal submission reused a failed test quote")
	}
	before = creates
	if quoteFrom(submit(campaign, true, ctx)) != testQuote || creates != before {
		t.Fatal("normal submission discarded unfinished test progress")
	}

	campaign = newCampaign()
	interrupted, cancel = context.WithCancel(ctx)
	interruptNormal = cancel
	if w := submit(campaign, true, interrupted); w.Code == 200 {
		t.Fatal("expected interrupted test submission")
	}
	testJournal, err = a.loadPrintIQJournal(ctx, campaign, true)
	if err != nil || testJournal == nil {
		t.Fatal("test checkpoint missing", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE campaigns SET form_data=jsonb_set(form_data,'{campaignName}','"Revised test"'::jsonb) WHERE id=$1`, campaign.ID); err != nil {
		t.Fatal(err)
	}
	testQuote = quoteFrom(submit(campaign, true, ctx))
	if testQuote == extractQuoteNo(testJournal.Steps["Sydney:0"].Response) {
		t.Fatal("changed test inputs reused the unfinished quote")
	}
	var archived bool
	if err := pool.QueryRow(ctx, `SELECT completed AND data->>'Superseded'='true' FROM printiq_submission_progress WHERE id=$1`, testJournal.ID).Scan(&archived); err != nil || !archived {
		t.Fatal("old test was not retained as superseded", err)
	}
	user.Role = "admin"
	before = creates
	if w := submit(campaign, true, ctx); w.Code != 403 || creates != before {
		t.Fatal("Test Submit lost its super-admin restriction")
	}
}
