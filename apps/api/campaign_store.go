package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type campaignStore struct {
	pool *pgxpool.Pool
}

type campaignRow struct {
	ID                string
	TenantID          string
	CreatedByUserID   string
	UpdatedByUserID   string
	Status            string
	FormData          []byte
	SummaryData       []byte
	PurchaseOrderData []byte
	LatestQuoteAmount *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func newCampaignStore(pool *pgxpool.Pool) *campaignStore {
	return &campaignStore{pool: pool}
}

func parseDateOrNil(value string) any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func parseWeeks(value string) int {
	weeks, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || weeks < 1 {
		return 1
	}
	if weeks > 52 {
		return 52
	}
	return weeks
}

func cloneOrderFormValues(values orderFormValues) orderFormValues {
	cloned := values
	cloned.CampaignMarkets = append([]campaignMarket(nil), values.CampaignMarkets...)
	for marketIndex := range cloned.CampaignMarkets {
		cloned.CampaignMarkets[marketIndex].Assets = append([]campaignAsset(nil), values.CampaignMarkets[marketIndex].Assets...)
		for assetIndex := range cloned.CampaignMarkets[marketIndex].Assets {
			cloned.CampaignMarkets[marketIndex].Assets[assetIndex].SelectedWeeks = append([]int(nil), values.CampaignMarkets[marketIndex].Assets[assetIndex].SelectedWeeks...)
		}
	}
	cloned.SelectedJobOperations = append([]string(nil), values.SelectedJobOperations...)
	cloned.SelectedSectionOperations = append([]string(nil), values.SelectedSectionOperations...)
	return cloned
}

func marshalJSON(value any) ([]byte, error) {
	return json.Marshal(value)
}

func decodeCampaignRow(row campaignRow) (*campaignRecord, error) {
	values := orderFormValues{}
	if len(row.FormData) > 0 {
		if err := json.Unmarshal(row.FormData, &values); err != nil {
			return nil, err
		}
	}

	var summary *campaignSummary
	if len(row.SummaryData) > 0 {
		var decoded campaignSummary
		if err := json.Unmarshal(row.SummaryData, &decoded); err != nil {
			return nil, err
		}
		summary = &decoded
	}

	var purchaseOrder *purchaseOrderDetails
	if len(row.PurchaseOrderData) > 0 {
		var decoded purchaseOrderDetails
		if err := json.Unmarshal(row.PurchaseOrderData, &decoded); err != nil {
			return nil, err
		}
		purchaseOrder = &decoded
	}

	var latestQuoteAmount any
	if row.LatestQuoteAmount != nil {
		latestQuoteAmount = *row.LatestQuoteAmount
	}

	return &campaignRecord{
		ID:                row.ID,
		TenantID:          row.TenantID,
		CreatedByUserID:   row.CreatedByUserID,
		UpdatedByUserID:   row.UpdatedByUserID,
		Status:            row.Status,
		Values:            values,
		Summary:           summary,
		PurchaseOrder:     purchaseOrder,
		LatestQuoteAmount: latestQuoteAmount,
		CreatedAt:         row.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:         row.UpdatedAt.UTC().Format(time.RFC3339),
	}, nil
}

type campaignListItem struct {
	ID                string `json:"id"`
	TenantID          string `json:"tenantId"`
	Status            string `json:"status"`
	CampaignName      string `json:"campaignName"`
	CampaignStartDate string `json:"campaignStartDate"`
	DueDate           string `json:"dueDate"`
	NumberOfWeeks     string `json:"numberOfWeeks"`
	MarketCount       int    `json:"marketCount"`
	AssetCount        int    `json:"assetCount"`
	LatestQuoteAmount any    `json:"latestQuoteAmount"`
	UpdatedAt         string `json:"updatedAt"`
	CreatedAt         string `json:"createdAt"`
}

func scanCampaignRow(scanner interface {
	Scan(dest ...any) error
}) (campaignRow, error) {
	var row campaignRow
	err := scanner.Scan(
		&row.ID,
		&row.TenantID,
		&row.CreatedByUserID,
		&row.UpdatedByUserID,
		&row.Status,
		&row.FormData,
		&row.SummaryData,
		&row.PurchaseOrderData,
		&row.LatestQuoteAmount,
		&row.CreatedAt,
		&row.UpdatedAt,
	)
	return row, err
}

func normalizeCampaignLines(values orderFormValues) []campaignLine {
	lines := make([]campaignLine, 0)
	for _, market := range values.CampaignMarkets {
		for _, asset := range market.Assets {
			lines = append(lines, campaignLine{
				ID:            asset.ID,
				AssetID:       asset.AssetID,
				AssetSearch:   asset.AssetSearch,
				SelectedWeeks: append([]int(nil), asset.SelectedWeeks...),
				Market:        market.Market,
			})
		}
	}
	return lines
}

func (s *campaignStore) replaceCampaignLines(ctx context.Context, tx pgx.Tx, campaignID, tenantID string, values orderFormValues) error {
	if _, err := tx.Exec(ctx, `DELETE FROM campaign_lines WHERE campaign_id = $1 AND tenant_id = $2`, campaignID, tenantID); err != nil {
		return err
	}

	sortOrder := 0
	for _, market := range values.CampaignMarkets {
		for _, asset := range market.Assets {
			selectedWeeksJSON, err := marshalJSON(asset.SelectedWeeks)
			if err != nil {
				return err
			}
			lineID := strings.TrimSpace(asset.ID)
			if lineID == "" {
				lineID = uuid.NewString()
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO campaign_lines (id, tenant_id, campaign_id, market, asset_id, asset_label, selected_weeks, sort_order, created_at, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW(), NOW())
			`, lineID, tenantID, campaignID, market.Market, asset.AssetID, asset.AssetSearch, string(selectedWeeksJSON), sortOrder); err != nil {
				return err
			}
			sortOrder++
		}
	}
	return nil
}

func (s *campaignStore) createCampaign(ctx context.Context, user AuthUser, values orderFormValues) (*campaignRecord, error) {
	if user.TenantID == nil {
		return nil, errors.New("current user is not assigned to a tenant")
	}

	formData, err := marshalJSON(values)
	if err != nil {
		return nil, err
	}

	campaignID := uuid.NewString()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		INSERT INTO campaigns (
			id, tenant_id, name, start_date, due_date, weeks, status, form_data, created_by_user_id, updated_by_user_id, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7::jsonb, $8, $8, NOW(), NOW())
	`, campaignID, *user.TenantID, strings.TrimSpace(values.CampaignName), parseDateOrNil(values.CampaignStartDate), parseDateOrNil(values.DueDate), parseWeeks(values.NumberOfWeeks), string(formData), user.ID); err != nil {
		return nil, err
	}

	if err := s.replaceCampaignLines(ctx, tx, campaignID, *user.TenantID, values); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.getCampaign(ctx, user, campaignID)
}

func (s *campaignStore) listCampaigns(ctx context.Context, user AuthUser) ([]campaignListItem, error) {
	if user.TenantID == nil {
		return nil, errors.New("current user is not assigned to a tenant")
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id, tenant_id, status, form_data, latest_quote_amount::text, updated_at, created_at
		FROM campaigns
		WHERE tenant_id = $1
		ORDER BY updated_at DESC, created_at DESC
	`, *user.TenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]campaignListItem, 0)
	for rows.Next() {
		var id string
		var tenantID string
		var status string
		var formData []byte
		var latestQuoteAmount *string
		var updatedAt time.Time
		var createdAt time.Time
		if err := rows.Scan(&id, &tenantID, &status, &formData, &latestQuoteAmount, &updatedAt, &createdAt); err != nil {
			return nil, err
		}

		values := orderFormValues{}
		if len(formData) > 0 {
			if err := json.Unmarshal(formData, &values); err != nil {
				return nil, err
			}
		}

		var quoteAmount any
		if latestQuoteAmount != nil {
			quoteAmount = *latestQuoteAmount
		}

		marketCount := len(values.CampaignMarkets)
		assetCount := 0
		for _, market := range values.CampaignMarkets {
			assetCount += len(market.Assets)
		}

		items = append(items, campaignListItem{
			ID:                id,
			TenantID:          tenantID,
			Status:            status,
			CampaignName:      strings.TrimSpace(values.CampaignName),
			CampaignStartDate: strings.TrimSpace(values.CampaignStartDate),
			DueDate:           strings.TrimSpace(values.DueDate),
			NumberOfWeeks:     strings.TrimSpace(values.NumberOfWeeks),
			MarketCount:       marketCount,
			AssetCount:        assetCount,
			LatestQuoteAmount: quoteAmount,
			UpdatedAt:         updatedAt.UTC().Format(time.RFC3339),
			CreatedAt:         createdAt.UTC().Format(time.RFC3339),
		})
	}

	return items, rows.Err()
}

func (s *campaignStore) getCampaign(ctx context.Context, user AuthUser, campaignID string) (*campaignRecord, error) {
	if user.TenantID == nil {
		return nil, errors.New("current user is not assigned to a tenant")
	}

	row, err := scanCampaignRow(s.pool.QueryRow(ctx, `
		SELECT id, tenant_id, created_by_user_id, updated_by_user_id, status, form_data, calculation_summary, purchase_order, latest_quote_amount::text, created_at, updated_at
		FROM campaigns
		WHERE id = $1 AND tenant_id = $2
		LIMIT 1
	`, campaignID, *user.TenantID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("Campaign not found")
	}
	if err != nil {
		return nil, err
	}
	return decodeCampaignRow(row)
}

func (s *campaignStore) updateCampaign(ctx context.Context, user AuthUser, campaignID string, values orderFormValues) (*campaignRecord, error) {
	if user.TenantID == nil {
		return nil, errors.New("current user is not assigned to a tenant")
	}
	formData, err := marshalJSON(values)
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	commandTag, err := tx.Exec(ctx, `
		UPDATE campaigns
		SET name = $3,
			start_date = $4,
			due_date = $5,
			weeks = $6,
			status = 'draft',
			form_data = $7::jsonb,
			calculation_summary = NULL,
			latest_quote_amount = NULL,
			submitted_at = NULL,
			updated_by_user_id = $8,
			updated_at = NOW()
		WHERE id = $1 AND tenant_id = $2
	`, campaignID, *user.TenantID, strings.TrimSpace(values.CampaignName), parseDateOrNil(values.CampaignStartDate), parseDateOrNil(values.DueDate), parseWeeks(values.NumberOfWeeks), string(formData), user.ID)
	if err != nil {
		return nil, err
	}
	if commandTag.RowsAffected() == 0 {
		return nil, errors.New("Campaign not found")
	}

	if err := s.replaceCampaignLines(ctx, tx, campaignID, *user.TenantID, values); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.getCampaign(ctx, user, campaignID)
}

func (s *campaignStore) setPurchaseOrder(ctx context.Context, user AuthUser, campaignID string, upload uploadResponse) (*campaignRecord, error) {
	if user.TenantID == nil {
		return nil, errors.New("current user is not assigned to a tenant")
	}

	purchaseOrder := purchaseOrderDetails{
		OriginalName: upload.OriginalName,
		StoredName:   upload.StoredName,
		MimeType:     upload.MimeType,
		Size:         upload.Size,
		UploadedAt:   upload.UploadedAt,
	}
	payload, err := marshalJSON(purchaseOrder)
	if err != nil {
		return nil, err
	}

	commandTag, err := s.pool.Exec(ctx, `
		UPDATE campaigns
		SET purchase_order = $3::jsonb,
			updated_by_user_id = $4,
			updated_at = NOW()
		WHERE id = $1 AND tenant_id = $2
	`, campaignID, *user.TenantID, string(payload), user.ID)
	if err != nil {
		return nil, err
	}
	if commandTag.RowsAffected() == 0 {
		return nil, errors.New("Campaign not found")
	}
	return s.getCampaign(ctx, user, campaignID)
}

func (s *campaignStore) calculateCampaign(ctx context.Context, user AuthUser, campaignID string, calculator *calculatorService) (*campaignRecord, campaignSummary, error) {
	campaign, err := s.getCampaign(ctx, user, campaignID)
	if err != nil {
		return nil, campaignSummary{}, err
	}

	lines := normalizeCampaignLines(campaign.Values)
	summary, err := calculator.calculateCampaign(campaign.TenantID, lines)
	if err != nil {
		return nil, campaignSummary{}, err
	}
	campaign.Values.Quantity = strconv.Itoa(summary.GrandTotal.TotalUnits)

	formData, err := marshalJSON(campaign.Values)
	if err != nil {
		return nil, campaignSummary{}, err
	}
	summaryData, err := marshalJSON(summary)
	if err != nil {
		return nil, campaignSummary{}, err
	}

	if _, err := s.pool.Exec(ctx, `
		UPDATE campaigns
		SET status = 'calculated',
			form_data = $3::jsonb,
			calculation_summary = $4::jsonb,
			updated_by_user_id = $5,
			updated_at = NOW()
		WHERE id = $1 AND tenant_id = $2
	`, campaignID, campaign.TenantID, string(formData), string(summaryData), user.ID); err != nil {
		return nil, campaignSummary{}, err
	}

	updatedCampaign, err := s.getCampaign(ctx, user, campaignID)
	if err != nil {
		return nil, campaignSummary{}, err
	}
	return updatedCampaign, summary, nil
}

func (s *campaignStore) recordSubmission(ctx context.Context, user AuthUser, campaignID string, requestPayload, responsePayload any, amount any) (*campaignRecord, error) {
	campaign, err := s.getCampaign(ctx, user, campaignID)
	if err != nil {
		return nil, err
	}

	requestPayloadJSON, err := marshalJSON(requestPayload)
	if err != nil {
		return nil, err
	}
	responsePayloadJSON, err := marshalJSON(responsePayload)
	if err != nil {
		return nil, err
	}

	var amountText *string
	if amount != nil {
		value := fmt.Sprintf("%v", amount)
		amountText = &value
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	quoteID := uuid.NewString()
	if _, err := tx.Exec(ctx, `
		INSERT INTO quotes (id, tenant_id, campaign_id, amount, status, request_payload, response_payload, created_by_user_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'priced', $5::jsonb, $6::jsonb, $7, NOW(), NOW())
	`, quoteID, campaign.TenantID, campaign.ID, amountText, string(requestPayloadJSON), string(responsePayloadJSON), user.ID); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO jobs (id, tenant_id, campaign_id, quote_id, external_job_id, status, request_payload, response_payload, created_by_user_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NULL, 'submitted_to_printiq', $5::jsonb, $6::jsonb, $7, NOW(), NOW())
	`, uuid.NewString(), campaign.TenantID, campaign.ID, quoteID, string(requestPayloadJSON), string(responsePayloadJSON), user.ID); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE campaigns
		SET status = 'submitted',
			latest_quote_amount = $3,
			submitted_at = NOW(),
			updated_by_user_id = $4,
			updated_at = NOW()
		WHERE id = $1 AND tenant_id = $2
	`, campaign.ID, campaign.TenantID, amountText, user.ID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return s.getCampaign(ctx, user, campaign.ID)
}
